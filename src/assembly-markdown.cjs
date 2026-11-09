'use strict';

// Compile selected source snapshots, never mutate the source notes. The result
// is a normal handout that uses Mathsemble's existing answer/print pipeline.
function stripFrontmatter(text) {
  const value = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!/^---\s*\n/.test(value)) return value;
  const end = /^---\s*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(value);
  if (!end) throw new Error('源笔记 frontmatter 未闭合，无法安全组题');
  return value.slice(end[0].length);
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
function protectLiterals(source, protector) {
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
  let out = '', i = 0;
  while (i < text.length) {
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
function encodePath(value) {
  return value.split('/').map(part => encodeURIComponent(part).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/');
}
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
  const suffix = wiki ? parts.suffix : parts.suffix ? '#' + encodeURIComponent(parts.suffix.slice(1)) : '';
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
  const blocks = ['---\nnote_type: handout\ntitle: ' + JSON.stringify(title) + '\n---\n\n# ' + plainTitle(title)];
  let questionNumber = 0;
  for (let i=0;i<resolved.length;i++) {
    const {entry,item,status} = resolved[i];
    if (!entry || entry.entryId !== plan.entries[i].entryId) throw new Error('组题引用顺序不一致');
    if (entry.kind === 'section') { blocks.push('## ' + plainTitle(entry.title || '分区')); continue; }
    if (status !== 'ok' || !item) throw new Error(`来源${status === 'changed' ? '已更新，请先更新引用' : '缺失或冲突'}：${entry.title || entry.sourcePath || entry.sourceId}`);
    if (!['question','knowledge'].includes(entry.kind)) throw new Error('不支持的编排类型');
    const source = stripFrontmatter(item.markdown);
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
      blocks.push(`##### ${role}${++questionNumber} ${display}\n\n${body}`);
    }
  }
  return blocks.join('\n\n') + '\n';
}
module.exports = {compileMarkdown};
