'use strict';

const {stripFrontmatter, makeProtector, protectLiterals, rewriteLinks, escapedAt, markdownLinkBounds} =
  typeof mwbAssemblyMarkdown !== 'undefined' ? mwbAssemblyMarkdown : require('./assembly-markdown.cjs');

function destination(text) {
  const match = /^(?:<([^>\n]*)>|((?:\\.|[^\s])+))/.exec(text.trim());
  return match && (match[1] ?? match[2]).replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~ ])/g, '$1');
}

function decoded(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function* lineEmbeds(line, protect) {
  for (const opening of line.matchAll(/!\[/g)) {
    const index = opening.index;
    if (escapedAt(line, index)) continue;
    if (line[index+2] === '[') {
      const close = line.indexOf(']]', index+3);
      if (close < 0) continue;
      const target = protect.restore(line.slice(index+3, close)).split('|')[0].trim();
      yield {index, end:close+2, target, syntax:'wiki-embed'};
    } else {
      const bounds = markdownLinkBounds(line, index+1);
      if (!bounds) continue;
      const target = destination(protect.restore(line.slice(bounds.start,bounds.close)));
      if (target) yield {index, end:bounds.close+1, target, syntax:'markdown-image'};
    }
  }
}

// All paths are vault paths. The host owns Obsidian's link resolution and
// heading/block boundaries. Expanded text exists only for this render.
async function expandHandoutEmbeds(markdown, sourcePath, {resolveLink, readFile, selectSubpath}) {
  const snapshots = new Map(), embeddedLinks = [];
  let occurrence = 0, rootLines;

  async function visit(raw, path, file, chain, isRoot, excerpt = false) {
    if (isRoot && !raw.includes('![')) return raw;
    const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const body = excerpt ? normalized : stripFrontmatter(normalized);
    const frontmatter = isRoot ? normalized.slice(0, normalized.length - body.length) : '';
    const protect = makeProtector(body);
    // Hide destinations and tag attributes during detection. For relocation
    // below we reveal them again so source-relative assets keep their owner.
    let scanned = protectLiterals(body, protect, {protectLinkDestinations:true, protectHtmlTags:true});
    scanned = scanned.replace(/%%[\s\S]*?(?:%%|$)/g, match => protect.save(match));
    let marker = 'MWBHANDOUTEMBED';
    while (body.includes(marker)) marker += 'X';
    const children = [];
    const lines = scanned.split('\n');
    const namespace = 'mwb-embed-' + ++occurrence;

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      for (const match of lineEmbeds(line, protect)) {
        const rawTarget = match.target;
        const hash = rawTarget.indexOf('#');
        const rawLink = hash < 0 ? rawTarget : rawTarget.slice(0, hash);
        if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(rawLink)) continue;
        const wiki = match.syntax === 'wiki-embed';
        const link = wiki ? rawLink : decoded(rawLink);
        const rawSubpath = hash < 0 ? '' : rawTarget.slice(hash);
        const subpath = wiki ? rawSubpath : decoded(rawSubpath);
        const target = link ? await resolveLink(link, path) : file || await resolveLink(path, path);
        const extension = (target?.extension || (target?.path || link).match(/\.([^.\/]+)$/)?.[1] || '').toLowerCase();
        if (extension && extension !== 'md' && extension !== 'markdown') continue;
        const where = `${protect.restore(line.slice(match.index, match.end))}（来源：${path}）`;
        if (!target?.path) throw new Error('找不到嵌入的 Markdown 笔记：' + where);
        const prefix = line.slice(0, match.index), after = line.slice(match.end);
        if (!/^(?: {0,3}>[ \t]?)* {0,3}$/.test(prefix) || after.trim())
          throw new Error('请将 Markdown 笔记嵌入单独放在正文或引用的一行：' + where);

        const key = target.path + subpath;
        if (chain.includes(key)) throw new Error('Markdown 笔记循环嵌入：' + [...chain,key].join(' → '));
        let contents = markdown;
        if (target.path !== sourcePath) {
          if (!snapshots.has(target.path)) {
            const stored = await readFile(target);
            if (typeof stored !== 'string') throw new Error('无法读取嵌入的 Markdown 笔记：' + where);
            snapshots.set(target.path, {path:target.path, file:target, markdown:stored});
          }
          contents = snapshots.get(target.path).markdown;
        }
        if (subpath) {
          contents = await selectSubpath?.(target, contents, subpath);
          if (typeof contents !== 'string' || !contents.trim())
            throw new Error('无法定位嵌入的标题或块：' + where);
        }
        embeddedLinks.push({sourcePath:path, target:link+rawSubpath, ...(wiki ? {} : {syntax:match.syntax})});
        const expanded = await visit(contents, target.path, target, [...chain,key], false, !!subpath);
        const quote = prefix.trimEnd();
        const quoted = expanded.trimEnd().split('\n').map(row => row ? prefix + row : quote);
        // Delimit a transclusion on both sides. Adjacent standalone embeds,
        // including ones inside a quote, stay independent Markdown blocks.
        const child = [quote, ...quoted, quote].join('\n');
        lines[index] = marker + children.length + 'END';
        children.push(child);
        break;
      }
    }
    if (isRoot && !children.length) return raw;
    if (isRoot) {
      let original = frontmatter.split('\n').length;
      rootLines = Array.from({length:original - 1}, (_, i) => i + 1);
      const replaced = new RegExp('^' + marker + '(\\d+)END$');
      const restored = lines.map(line => {
        const index = replaced.exec(line);
        const value = index ? children[Number(index[1])] : protect.restore(line);
        for (const _ of value.split('\n')) {
          rootLines.push(original);
          if (!index) original++;
        }
        if (index) original++;
        return value;
      });
      return frontmatter + restored.join('\n');
    }
    let text = protect.restore(lines.join('\n'));
    const literals = makeProtector(text);
    let protectedText = protectLiterals(text, literals);
    protectedText = protectedText.replace(/%%[\s\S]*?(?:%%|$)/g, match => literals.save(match));
    text = literals.restore(await rewriteLinks(protectedText, path, namespace, {outputPath:sourcePath, resolveLink}, literals));
    // Restore only markers emitted in this frame. Child Markdown already
    // uses the handout's path and its own reference/footnote namespace.
    return frontmatter + text.replace(new RegExp(marker + '(\\d+)END','g'), (_, i) => children[Number(i)]);
  }

  const expanded = await visit(markdown, sourcePath, null, [sourcePath], true);
  return {markdown:expanded, dependencies:[...snapshots.values()], embeddedLinks, ...(rootLines ? {rootLines} : {})};
}

module.exports = {expandHandoutEmbeds};
