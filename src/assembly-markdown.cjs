'use strict';

const fragments = typeof MWB_ASSEMBLY_FRAGMENTS !== 'undefined' ? MWB_ASSEMBLY_FRAGMENTS : require('./assembly-fragments.cjs');

// Compile selected source snapshots, never mutate the source notes. The result
// is a normal handout that uses Mathsemble's existing answer/print pipeline.
const {splitFrontmatter} = fragments;
function stripFrontmatter(text) {
  return splitFrontmatter(text).body;
}
function plainTitle(value) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').trim()
    .replace(/([\\`*_{}\[\]<>#!|])/g, '\\$1');
}
function normalizedLabel(value) { return String(value).trim().replace(/\s+/g, ' ').toLowerCase(); }
function escapedAt(text, index) {
  let n = 0;
  while (index > 0 && text[--index] === '\\') n++;
  return n % 2 === 1;
}
function markdownLinkBounds(text, opening) {
  let end = opening+1, depth = 1;
  for (;end<text.length;end++) {
    if (escapedAt(text,end)) continue;
    if (text[end] === '[') depth++;
    else if (text[end] === ']' && --depth === 0) break;
  }
  if (text[end+1] !== '(') return null;
  const start = end+2;
  let close = start, nesting = 1, angle = false, quote = '';
  for (;close<text.length;close++) {
    if (escapedAt(text,close)) continue;
    const c = text[close];
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '<' && !text.slice(start,close).trim()) angle = true;
    else if (c === '>' && angle) angle = false;
    else if (!angle && /["']/.test(c) && /\s/.test(text[close-1]||'')) quote = c;
    else if (!angle && c === '(') nesting++;
    else if (!angle && c === ')' && --nesting === 0) break;
  }
  return close < text.length ? {end,start,close} : null;
}
function makeProtector(source) {
  let marker = 'MWBPROTECTEDTOKEN';
  while (source.includes(marker)) marker += 'X';
  const values = [];
  const save = value => `${marker}${values.push(value) - 1}ENDTOKEN`;
  const restore = text => {
    // A protected Wiki link can contain an already protected math label.
    let output = text;
    for (let pass = 0; pass <= values.length; pass++) {
      const next = output.replace(new RegExp(marker + '(\\d+)ENDTOKEN', 'g'), (_, n) => values[Number(n)]);
      if (next === output) return output;
      output = next;
    }
    throw new Error('字面内容恢复失败');
  };
  return {save, restore};
}

// Code and math are literal throughout link and heading rewriting. Keep quoted
// code fences too: answer Callouts commonly contain fenced examples.
function protectLiterals(source, protector, options = {}) {
  const lines = source.split('\n');
  const result = [];
  let listContext = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^ {0,3}(?:[-+*]|\d+[.)])[ \t]+/.test(lines[i])) listContext = true;
    else if (lines[i].trim() && !/^[ \t>]/.test(lines[i])) listContext = false;
    if (!listContext && /^(?: {4}|\t)/.test(lines[i]) && (i === 0 || !lines[i-1].trim())) {
      const begin = i;
      while (i + 1 < lines.length && (!lines[i+1].trim() || /^(?: {4}|\t)/.test(lines[i+1]))) i++;
      result.push(protector.save(lines.slice(begin,i+1).join('\n'))); continue;
    }
    const opening = /^(?: {0,3}>[ \t]?)* {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (opening && !(opening[1][0] === '`' && opening[2].includes('`'))) {
      const begin = i, fence = opening[1];
      for (i++; i < lines.length; i++) {
        const closing = /^(?: {0,3}>[ \t]?)* {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[i]);
        if (closing && closing[1][0] === fence[0] && closing[1].length >= fence.length) break;
      }
      if (i >= lines.length) throw new Error('源笔记代码围栏未闭合，无法安全组题');
      result.push(protector.save(lines.slice(begin, i + 1).join('\n')));
    } else result.push(lines[i]);
  }
  const text = result.join('\n');
  const destinations = new Map();
  if (options.protectLinkDestinations) {
    for (const match of text.matchAll(/^((?: {0,3}>[ \t]?)* {0,3}\[[^\]\n]+\]:[ \t]*)([^\n]+)/gm))
      destinations.set(match.index+match[1].length,match.index+match[0].length);
  }
  let out = '', i = 0;
  while (i < text.length) {
    if (destinations.has(i)) {
      const end = destinations.get(i);
      out += protector.save(text.slice(i,end)); i = end; continue;
    }
    if (options.protectLinkDestinations && text[i] === '[' && !escapedAt(text,i) && text[i+1] !== '[') {
      const link = markdownLinkBounds(text,i);
      if (link && link.start < link.close) destinations.set(link.start,link.close);
    }
    if (options.protectLinkDestinations && text.startsWith('[[',i) && !escapedAt(text,i)) {
      const end = text.indexOf(']]',i+2);
      if (end >= 0 && !text.slice(i,end).includes('\n')) {
        out += '[['+protector.save(text.slice(i+2,end))+']]';i = end+2;continue;
      }
    }
    let end = -1;
    if (text.startsWith('<!--', i)) {
      const close = text.indexOf('-->', i + 4);
      if (close < 0) throw new Error('源笔记 HTML 注释未闭合');
      end = close + 3;
    } else if (text[i] === '<') {
      const raw = /^<(pre|code|script|style|textarea)\b[^>]*>/i.exec(text.slice(i));
      if (raw) {
        const close = new RegExp('</' + raw[1] + '\\s*>', 'ig');
        close.lastIndex = i + raw[0].length;
        const match = close.exec(text);
        if (!match) throw new Error('源笔记 HTML 字面块未闭合');
        end = match.index + match[0].length;
      } else if (options.protectHtmlTags) {
        const tag = /^<\/?[A-Za-z][\w:-]*(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/.exec(text.slice(i));
        if (tag) {
          const token = protector.save(tag[0]);
          options.onHtmlTag?.(token,tag[0]);
          out += token; i += tag[0].length; continue;
        }
      }
    } else if (text[i] === '`' && !escapedAt(text, i)) {
      const ticks = /^`+/.exec(text.slice(i))[0];
      let cursor = i + ticks.length;
      while (cursor < text.length) {
        const at = text.indexOf(ticks, cursor);
        if (at < 0) break;
        if (text[at - 1] !== '`' && text[at + ticks.length] !== '`') { end = at + ticks.length; break; }
        cursor = at + ticks.length;
      }
    } else if ((text[i] === '$' || text.startsWith('\\[', i) || text.startsWith('\\(', i)) && !escapedAt(text, i)) {
      const delimiter = text.startsWith('$$', i) ? '$$' : text[i] === '$' ? '$' : text.slice(i, i + 2);
      const close = delimiter === '\\[' ? '\\]' : delimiter === '\\(' ? '\\)' : delimiter;
      let cursor = i + delimiter.length;
      while (cursor < text.length) {
        const at = text.indexOf(close, cursor);
        if (at < 0 || (delimiter === '$' && text.slice(i, at).includes('\n\n'))) break;
        if (!escapedAt(text, at) && !(delimiter === '$' && text[at + 1] === '$')) { end = at + close.length; break; }
        cursor = at + close.length;
      }
      if (end < 0 && delimiter !== '$') throw new Error('源笔记数学块未闭合，无法安全组题');
    }
    if (end >= 0) { out += protector.save(text.slice(i, end)); i = end; }
    else out += text[i++];
  }
  return out;
}

// Collect declarations from a captured note, without resolving files, reading
// the vault, fetching URLs, or requiring the note to be an assembly input.
function collectMediaDependencies(markdown, sourcePath = '') {
  const dependencies = [], issues = [];
  const htmlEntities = value => String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, entity) => {
    if (entity[0] !== '#') return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0'}[entity.toLowerCase()];
    const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2),16) : Number(entity.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\ufffd';
  });
  const add = (rawTarget, syntax, options = {}) => {
    const raw = String(rawTarget || '');
    let target = syntax === 'html-image' || syntax === 'html-embed' ? htmlEntities(raw) : raw;
    target = target.trim();
    if (syntax !== 'wiki-embed') target = target.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~ ])/g,'$1');
    if (syntax !== 'wiki-embed' && !isExternal(target)) {
      const parts = splitTarget(target);
      try { parts.path = decodeURIComponent(parts.path); } catch (_) { /* Literal percent. */ }
      target = parts.path + parts.suffix;
    }
    let status = options.status || 'declared', reasonCode = options.reasonCode || '';
    if (!target && !reasonCode) { status = 'unresolved'; reasonCode = 'empty-target'; }
    if (syntax === 'wiki-embed' && !reasonCode) {
      const ext = /\.([^.\/]+)$/.exec(splitTarget(target).path)?.[1].toLowerCase();
      if (!ext) { status = 'unresolved'; reasonCode = 'wiki-target-needs-resolution'; }
      else if (!/^(?:png|jpe?g|gif|webp|svg|bmp|avif|ico)$/.test(ext)) {
        status = 'unsupported'; reasonCode = 'unsupported-wiki-embed';
      }
    }
    const row = {sourcePath:String(sourcePath || ''),syntax,rawTarget:raw,target,status,reasonCode};
    dependencies.push(row);
    if (status !== 'declared') issues.push({...row});
  };
  let text, protector;
  const tags = new Map();
  try {
    const source = stripFrontmatter(markdown);
    protector = makeProtector(source);
    text = protectLiterals(source,protector,{protectHtmlTags:true,protectLinkDestinations:true,
      onHtmlTag:(token,tag)=>tags.set(token,tag)});
  } catch (_) {
    add('', 'markdown', {status:'unsupported',reasonCode:'unparsed-markdown'});
    return {dependencies,issues};
  }
  const definitions = new Map();
  text = text.replace(/^(?: {0,3}>[ \t]?)* {0,3}\[([^\]\n]+)\]:[ \t]*([^\n]*)$/gm, (all,label,body) => {
    const destination = /^(?:<([^>\n]*)>|((?:\\.|[^\s])+))/.exec(protector.restore(body));
    if (destination && !label.startsWith('^') && !definitions.has(normalizedLabel(label)))
      definitions.set(normalizedLabel(label),destination[1] ?? destination[2]);
    return '\n'.repeat((all.match(/\n/g)||[]).length);
  });
  const reference = (label, syntax = 'reference-image') => {
    const target = definitions.get(normalizedLabel(label));
    if (target !== undefined) add(target,syntax);
    else add('',syntax,{status:'unresolved',reasonCode:'missing-image-reference'});
  };
  const scan = input => {
    let retained = '', cursor = 0;
    for (let i = 0; i < input.length; i++) {
      if (input[i] !== '[' || escapedAt(input,i)) continue;
      const image = input[i-1] === '!' && !escapedAt(input,i-1);
      const opening = image ? i-1 : i;
      if (input[i+1] === '[') {
        const end = input.indexOf(']]',i+2);
        if (end < 0 || input.slice(i,end).includes('\n')) continue;
        if (image) add(protector.restore(input.slice(i+2,end)).split('|')[0],'wiki-embed');
        retained += input.slice(cursor,opening); cursor = end+2; i = end+1; continue;
      }
      let end = i+1, depth = 1;
      for (;end<input.length;end++) {
        if (escapedAt(input,end)) continue;
        if (input[end] === '[') depth++;
        else if (input[end] === ']' && --depth === 0) break;
      }
      if (end >= input.length) continue;
      const label = input.slice(i+1,end);
      if (input[end+1] === '(') {
        const bounds = markdownLinkBounds(input,i);
        if (!bounds) continue;
        const {start,close} = bounds;
        const inside = protector.restore(input.slice(start,close)).trim();
        const match = /^(?:<([^>\n]*)>|((?:\\.|[^\s])+))([\s\S]*)$/.exec(inside);
        if (match && image) add(match[1] ?? match[2],'markdown-image');
        else if (image && !inside) add('','markdown-image');
        else if (image) add(inside,'markdown-image',{status:'unresolved',reasonCode:'unparsed-image-destination'});
        retained += input.slice(cursor,opening) + (image ? '' : scan(label));
        cursor = close+1; i = close; continue;
      }
      if (input[end+1] === '[') {
        const close = input.indexOf(']',end+2);
        if (close >= 0 && !input.slice(end+2,close).includes('\n')) {
          if (image) reference(protector.restore(input.slice(end+2,close) || label));
          retained += input.slice(cursor,opening) + (image ? '' : scan(label));
          cursor = close+1; i = close; continue;
        }
      }
      if (definitions.has(normalizedLabel(protector.restore(label)))) {
        if (image) reference(protector.restore(label));
        retained += input.slice(cursor,opening) + (image ? '' : scan(label));
        cursor = end+1; i = end;
      }
    }
    return retained + input.slice(cursor);
  };
  const visible = scan(text);
  for (const [token,tag] of tags) {
    if (!visible.includes(token) || /^<\//.test(tag)) continue;
    const name = /^<([\w:-]+)/.exec(tag)[1].toLowerCase();
    const attributes = new Map();
    const body = tag.slice(name.length+1,-1);
    for (const match of body.matchAll(/([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      const key = match[1].toLowerCase();
      if (!attributes.has(key)) attributes.set(key,match[2] ?? match[3] ?? match[4] ?? '');
    }
    if (name === 'img') {
      if (attributes.has('src')) add(attributes.get('src'),'html-image');
      if (attributes.has('srcset')) add(attributes.get('srcset'),'html-image',{status:'unsupported',reasonCode:'unsupported-html-srcset'});
    } else if (['audio','video','iframe','embed','object','source'].includes(name)) {
      const raw = attributes.get(name === 'object' ? 'data' : 'src') || attributes.get('srcset');
      if (raw !== undefined) add(raw,'html-embed',{status:'unsupported',reasonCode:'unsupported-html-embed'});
    }
  }
  return {dependencies,issues};
}
function normalizePath(path) {
  const parts = [];
  for (const part of String(path).replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) throw new Error('链接路径超出笔记库'); parts.pop(); }
    else parts.push(part);
  }
  return parts.join('/');
}
function relativePath(path, outputPath) {
  const from = normalizePath(outputPath).split('/').slice(0, -1), to = normalizePath(path).split('/');
  while (from.length && to.length && from[0] === to[0]) { from.shift(); to.shift(); }
  return [...from.map(() => '..'), ...to].join('/') || '.';
}
function encodeComponent(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}
function encodePath(value) { return value.split('/').map(encodeComponent).join('/'); }
function isExternal(value) { return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value); }
function splitTarget(value) {
  const index = value.indexOf('#');
  return index < 0 ? {path:value, suffix:''} : {path:value.slice(0, index), suffix:value.slice(index)};
}
async function mapTarget(raw, sourcePath, options, image, wiki = false) {
  let target = String(raw).trim();
  if (isExternal(target)) return target;
  target = target.replace(/\\([()\[\] <>])/g, '$1');
  const parts = splitTarget(target);
  // A Markdown fragment can already contain URL escapes, including %25 itself.
  let suffix = parts.suffix;
  if (!wiki && suffix) suffix = '#' + encodeComponent(suffix.slice(1)).replace(/%25([0-9a-f]{2})/gi, '%$1');
  let decoded = parts.path;
  // Markdown destinations are URLs; Wiki targets are literal vault paths.
  // Pass a canonical path to the host resolver, which must not decode again.
  if (!wiki) try { decoded = decodeURIComponent(decoded); } catch (_) { /* Literal percent in a filename. */ }
  const resolved = decoded ? await options.resolveLink(decoded, sourcePath) : {path:sourcePath, extension:'md'};
  if (!resolved) {
    if (image) throw new Error(`图片或嵌入无法定位：${raw}（来源：${sourcePath}）`);
    // Preserve an unresolvable link's original source context as an explicit
    // path, so a same-named note beside the generated handout cannot capture it.
    const fallback = normalizePath(sourcePath.split('/').slice(0,-1).concat(decoded).join('/'));
    return wiki ? fallback + suffix : encodePath(relativePath(fallback, options.outputPath)) + suffix;
  }
  if (!resolved.path || typeof resolved.path !== 'string') throw new Error('链接解析器未返回有效路径');
  const ext = String(resolved.extension || resolved.path.split('.').pop()).toLowerCase();
  if (image && ['md','markdown'].includes(ext)) throw new Error(`暂不支持嵌入 Markdown 笔记：${raw}；请将该知识笔记整篇加入编排`);
  const path = normalizePath(resolved.path);
  if (wiki && /[\[\]|\r\n]/.test(path)) throw new Error('Wiki 链接目标含无法安全表示的字符：' + path);
  return wiki ? path + suffix : encodePath(relativePath(path, options.outputPath)) + suffix;
}
async function replaceAsync(text, expression, replacer) {
  let out = '', cursor = 0;
  for (const match of text.matchAll(expression)) {
    out += text.slice(cursor, match.index) + await replacer(match);
    cursor = match.index + match[0].length;
  }
  return out + text.slice(cursor);
}

async function rewriteLinks(source, path, prefix, options, protector) {
  let text = source;
  const labels = new Map();
  for (const m of text.matchAll(/^(?: {0,3}>[ \t]?)* {0,3}\[([^\]\n]+)\]:/gm)) {
    const label = m[1], key = normalizedLabel(label.replace(/^\^/, ''));
    labels.set((label.startsWith('^') ? '^' : '') + key, `${prefix}-${key}`);
  }
  const name = label => prefix + '-' + normalizedLabel(label);
  // References are namespaced before rewriting their resource destinations.
  text = text.replace(/^(\s*(?:>[ \t]?)* {0,3})\[(\^?)([^\]\n]+)\]:/gm,
    (_, indent, footnote, label) => `${indent}[${footnote}${name(label)}]:`);
  text = text.replace(/(?<!\\)\[\^([^\]\n]+)\](?!:)/g, (_, label) => `[^${name(label)}]`);
  text = text.replace(/(?<!\\)(!?\[[^\]\n]+\])\[([^\]\n]*)\]/g, (_, label, ref) =>
    `${label}[${name(ref || label.replace(/^!?\[|\]$/g,''))}]`);
  // Plain [text] becomes a shortcut only when a definition exists in THIS note.
  text = text.replace(/(?<![\\\[\]])(!?)\[([^\]\n]+)\](?![\[\](:])/g, (all, bang, label) =>
    labels.has(normalizedLabel(label)) ? `${bang}[${label}][${name(label)}]` : all);

  text = await replaceAsync(text, /(?<!\\)(!?)\[\[([^\]\n]+)\]\]/g, async m => {
    const bar = m[2].indexOf('|'), target = bar < 0 ? m[2] : m[2].slice(0,bar), alias = bar < 0 ? '' : m[2].slice(bar);
    const mapped = await mapTarget(protector.restore(target), path, options, !!m[1], true);
    return protector.save(`${m[1]}[[${mapped}${alias}]]`);
  });
  // Balanced () in inline Markdown destinations and escaped closing brackets.
  const inlineLinks = async text => {
  let out = '', cursor = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '[' || escapedAt(text,i) || text[i-1] === '[') continue;
    let end = i + 1, depth = 1;
    for (; end < text.length; end++) {
      if (escapedAt(text,end)) continue;
      if (text[end] === '[') depth++;
      if (text[end] === ']' && --depth === 0) break;
      // The decrement only applies to closing brackets.
      if (text[end] !== ']') depth += 0;
    }
    if (text[end+1] !== '(') continue;
    const start = end + 2;
    let close = start, nesting = 1, quoted = false;
    for (; close < text.length; close++) {
      if (escapedAt(text,close)) continue;
      if (text[close] === '<' && close === start) quoted = true;
      else if (text[close] === '>' && quoted) quoted = false;
      else if (!quoted && text[close] === '(') nesting++;
      else if (!quoted && text[close] === ')' && --nesting === 0) break;
    }
    if (close >= text.length) continue;
    const inside = text.slice(start,close);
    // Whitespace is only valid in angle destinations; remaining text is title.
    const match = /^(?:<([^>\n]*)>|((?:\\.|[^\s])+))([\s\S]*)$/.exec(inside);
    if (!match) { i = close; continue; }
    const image = text[i-1] === '!' && !escapedAt(text,i-1);
    const mapped = await mapTarget(protector.restore(match[1] ?? match[2]),path,options,image);
    const opening = image ? i-1 : i;
    out += text.slice(cursor,opening) + (image ? '!' : '') + '[' + await inlineLinks(text.slice(i+1,end)) + '](' + mapped + match[3] + ')';
    cursor = close+1; i = close;
  }
  return out + text.slice(cursor);
  };
  text = await inlineLinks(text);
  text = await replaceAsync(text, /^( {0,3}(?:>[ \t]?)*\[[^\]\n]+\]:[ \t]*)(?:<([^>\n]+)>|(\S+))([^\n]*)$/gm, async m => {
    if (/\[\^/.test(m[1])) return m[0];
    // Reference definitions can be used for either links or images. Detect
    // image uses after namespacing so missing image resources remain blockers.
    const label = /\[([^\]]+)\]:/.exec(m[1])[1];
    const image = text.includes(']['+label+']') && new RegExp('!\\[[^\\]]*\\]\\[' + label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '\\]').test(text);
    return m[1] + await mapTarget(protector.restore(m[2] || m[3]),path,options,image) + m[4];
  });
  text = await replaceAsync(text, /<[^>]+>/g, async m => {
    if (/^<h[1-5]\b/i.test(m[0])) throw new Error('原生 HTML 标题无法安全编排，请改用 Markdown 标题');
    if (!/\b(?:src|href)\s*=/i.test(m[0])) return m[0];
    const image = /^<img\b/i.test(m[0]);
    const unquoted = /\b(?:src|href)\s*=\s*([^\s"'][^\s>]*)/i.exec(m[0]);
    if (unquoted && !isExternal(unquoted[1])) throw new Error('HTML 相对资源属性必须加引号，或改用 Markdown 图片');
    return await replaceAsync(m[0], /\b(src|href)\s*=\s*(["'])(.*?)\2/gi, async attr => {
      if (!image && attr[1].toLowerCase() === 'src' && !isExternal(attr[3])) throw new Error('暂不支持此 HTML 相对资源，请改用 Markdown 图片');
      const mapped = await mapTarget(protector.restore(attr[3]),path,options,image);
      return `${attr[1]}=${attr[2]}${mapped.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}${attr[2]}`;
    });
  });
  return text;
}

function normalizeHeadings(text, kind) {
  const lines = text.split('\n');
  let firstContent = true;
  for (let i=0;i<lines.length;i++) {
    if (!lines[i].trim()) continue;
    const atx = /^(#{1,6})[ \t]+(.*)$/.exec(lines[i]);
    const setext = i+1 < lines.length && /^(?:=+|-+)[ \t]*$/.test(lines[i+1]) && lines[i+1] !== '------' &&
      !/^(?:[> \t]|MWBPROTECTEDTOKEN)/.test(lines[i]);
    if (firstContent && atx?.[1] === '#') { lines[i] = ''; firstContent = false; continue; }
    if (firstContent && setext && lines[i+1][0] === '=') { lines[i] = ''; lines[++i] = ''; firstContent = false; continue; }
    firstContent = false;
    if (atx) lines[i] = '#'.repeat(kind === 'question' ? 6 : Math.min(4, atx[1].length + 1)) + ' ' + atx[2];
    else if (setext) { lines[i] = (kind === 'question' ? '###### ' : '### ') + lines[i]; lines[++i] = ''; }
  }
  return lines.join('\n').trim();
}

async function compileMarkdown(plan, resolved, options = {}) {
  if (!plan || !Array.isArray(plan.entries) || !Array.isArray(resolved)) throw new Error('组题方案无效');
  if (resolved.length !== plan.entries.length) throw new Error('组题引用数量不一致');
  if (!plan.entries.some(entry => entry.kind !== 'section')) throw new Error('请先加入题目或知识正文');
  const config = {outputPath:'Mathsemble/讲义/讲义.md',...options};
  if (typeof config.resolveLink !== 'function') config.resolveLink = async () => null;
  const title = String(plan.title || '新讲义').replace(/[\r\n]+/g,' ').trim();
  const course = plan.course || {};
  const text = value => typeof value === 'string' ? value.trim() : '';
  const metadata = {note_type:'handout',title,
    titile:course.title == null ? title : text(course.title),author:text(course.teacher) || '孙老师',
    student:text(course.student),class_time:text(course.time),subject:text(course.subject),
    grade:text(course.grade),learning_objectives:text(course.objectives)};
  const blocks = ['---\n' + Object.entries(metadata).map(([key,value]) => key + ': ' + JSON.stringify(value)).join('\n') + '\n---\n\n# ' + plainTitle(title)];
  const origins = [null];
  let questionNumber = 0;
  for (let i=0;i<resolved.length;i++) {
    const {entry,item,status} = resolved[i];
    if (!entry || entry.entryId !== plan.entries[i].entryId) throw new Error('组题引用顺序不一致');
    if (entry.kind === 'section') { blocks.push('## ' + plainTitle(entry.title || '分区')); origins.push(null); continue; }
    if (status !== 'ok' || !item) throw new Error(`来源${status === 'changed' ? '已变化，请先接受来源更新' : '缺失或冲突'}：${entry.title || entry.sourcePath || entry.sourceId}`);
    if (!['question','knowledge'].includes(entry.kind)) throw new Error('不支持的编排类型');
    const fragmentSource={...item,kind:entry.kind};
    const projected=entry.fragmentRef?fragments.resolveFragment(fragmentSource,entry.fragmentRef):null;
    const structural=projected?null:fragments.parseFragments(fragmentSource);
    const source = projected?projected.markdown:structural.supported&&structural.valid?structural.wholeMarkdown:stripFrontmatter(item.markdown);
    const protector = makeProtector(source);
    let body = protectLiterals(source,protector);
    body = await rewriteLinks(body,item.path,`mwb-${i+1}`,config,protector);
    body = protector.restore(normalizeHeadings(body,entry.kind));
    if (!body.trim()) throw new Error('来源正文为空：' + item.path);
    const display = plainTitle(entry.title || item.title || item.path.split('/').pop().replace(/\.md$/i,''));
    if (entry.kind === 'knowledge') blocks.push('## ' + display + '\n\n' + body);
    else {
      const roles = {example:'例题',variant:'变式',practice:'训练',problem:'训练','例题':'例题','变式':'变式','训练':'训练'};
      const role = roles[entry.role || item.role || item.metadata?.role] || '题';
      const score=Object.hasOwn(entry,'score')?fragments.validateScore(entry.score):projected?.score;
      if(projected?.score!=null&&score!==projected.score)throw new Error('整题分值与小问分值合计不一致');
      blocks.push(`##### ${role}${++questionNumber} ${display}${score!=null?'（'+score+' 分）':''}\n\n${body}`);
    }
    const fragmentReference=projected?Object.freeze({...projected.reference,
      ids:Object.freeze([...projected.reference.ids]),
      ...(projected.reference.scores?{scores:Object.freeze({...projected.reference.scores})}:{})}):null;
    origins.push(typeof item.path === 'string' && item.path ?
      {entryId:entry.entryId,kind:entry.kind,path:item.path,
        ...(fragmentReference?{fragmentRef:fragmentReference}:{}),
        ...(Object.hasOwn(entry,'score')?{score:entry.score}:{})} : null);
  }
  const markdown = blocks.join('\n\n') + '\n';
  if (typeof config.onSourceMap === 'function') {
    // These are generated-document ranges, not source-note line numbers.
    // Count the final restored blocks, including literal multiline content;
    // the joining blank lines belong to neither adjacent source entry.
    const sourceMap = [];
    let startLine = 1;
    for (let i=0;i<blocks.length;i++) {
      const lineCount = blocks[i].split('\n').length;
      if (origins[i]) sourceMap.push(Object.freeze({...origins[i],startLine,endLine:startLine+lineCount-1}));
      startLine += lineCount + 1;
    }
    config.onSourceMap(Object.freeze(sourceMap));
  }
  return markdown;
}
module.exports = {compileMarkdown,collectMediaDependencies,stripFrontmatter,makeProtector,protectLiterals,rewriteLinks,escapedAt,markdownLinkBounds};
