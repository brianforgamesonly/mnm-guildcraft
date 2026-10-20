#!/usr/bin/env node
// PreToolUse hook for Bash (work order 3, ITEM 4): blocks the command forms docs/ORDER-RULES.md forbids
// ("Commands and permissions"), so they are hard to use by accident. A pattern check, not a parser of
// every shell form: a BANDAGE, not a guarantee. Exit 2 blocks the call; the reason goes to stderr.
//
// Blocked:
//   1. chaining: && || ; and an unquoted newline, outside quotes and heredoc bodies (an escaped \; is allowed);
//   2. a leading VAR=value assignment (also `env VAR=value cmd`; `env -u VAR cmd` is allowed);
//   3. writing a code file (.ts .tsx .mts .cts .js .jsx .mjs .cjs .py) by heredoc, > or >> redirect, or tee;
//   4. in-place edits of a code file: sed -i / -i.bak / --in-place, perl -i;
//   5. node -e / -p / --eval or python -c code that writes a file.
// Allowed: pipes, heredocs carrying SQL or shell, `> file.json` (saving output), `2>&1`, `env -u VAR cmd`.

import { readFileSync } from 'node:fs';

const CODE_FILE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|py)$/i;
const RULE = 'docs/ORDER-RULES.md "Commands and permissions"';

/**
 * Splits a command into words and operators, honouring quotes and backslash escapes, and removes heredoc
 * bodies (they are data). Returns tokens: { op } for operators, { word, quoted } for words.
 */
export function tokenize(src) {
  const tokens = [];
  const heredocs = []; // delimiters waiting for their body, in order
  let i = 0;
  let word = '';
  let inWord = false;
  let quoted = false;
  const push = () => {
    if (inWord) tokens.push({ word, quoted });
    word = '';
    inWord = false;
    quoted = false;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === "'") {
      const end = src.indexOf("'", i + 1);
      const stop = end === -1 ? src.length : end;
      word += src.slice(i + 1, stop);
      inWord = true;
      quoted = true;
      i = stop + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < src.length) {
          word += src[j + 1];
          j += 2;
          continue;
        }
        word += src[j++];
      }
      inWord = true;
      quoted = true;
      i = j + 1;
      continue;
    }
    if (c === '\\') {
      if (src[i + 1] === '\n') {
        i += 2; // line continuation
        continue;
      }
      word += src[i + 1] ?? '';
      inWord = true;
      quoted = true; // an escaped character is literal (e.g. \; in find -exec)
      i += 2;
      continue;
    }
    if (c === '\n') {
      push();
      if (heredocs.length) {
        // Skip each pending heredoc body up to its delimiter line.
        let j = i + 1;
        while (heredocs.length) {
          const { delim, strip } = heredocs.shift();
          for (;;) {
            if (j >= src.length) break;
            const nl = src.indexOf('\n', j);
            const line = src.slice(j, nl === -1 ? src.length : nl);
            j = nl === -1 ? src.length : nl + 1;
            if ((strip ? line.replace(/^\t+/, '') : line) === delim) break;
          }
        }
        tokens.push({ op: 'heredoc-end' });
        i = j;
        // The command line after the bodies continues; a following newline is a separator again.
        if (i < src.length) tokens.push({ op: '\n' });
        continue;
      }
      tokens.push({ op: '\n' });
      i++;
      continue;
    }
    if (c === ' ' || c === '\t') {
      push();
      i++;
      continue;
    }
    const three = src.slice(i, i + 3);
    const two = src.slice(i, i + 2);
    if (two === '<<' && three !== '<<<') {
      push();
      let j = i + 2;
      const strip = src[j] === '-';
      if (strip) j++;
      while (src[j] === ' ' || src[j] === '\t') j++;
      let delim = '';
      if (src[j] === "'" || src[j] === '"') {
        const q = src[j];
        const end = src.indexOf(q, j + 1);
        delim = src.slice(j + 1, end === -1 ? src.length : end);
        j = end === -1 ? src.length : end + 1;
      } else {
        while (j < src.length && !/[\s;&|<>()]/.test(src[j])) delim += src[j++];
        delim = delim.replace(/\\/g, '');
      }
      heredocs.push({ delim, strip });
      tokens.push({ op: '<<', delim });
      i = j;
      continue;
    }
    if (two === '&&' || two === '||' || two === '>>' || two === '>&' || two === '&>' || two === '|&') {
      push();
      tokens.push({ op: two });
      i += 2;
      continue;
    }
    if (c === ';' || c === '|' || c === '>' || c === '<' || c === '&' || c === '(' || c === ')') {
      // A file descriptor number directly before a redirect belongs to the redirect (2>, 1>>).
      if ((c === '>' || c === '<') && inWord && /^\d+$/.test(word) && !quoted) {
        word = '';
        inWord = false;
      } else push();
      tokens.push({ op: c });
      i++;
      continue;
    }
    word += c;
    inWord = true;
    i++;
  }
  push();
  return tokens;
}

/** Pipeline segments: runs of words between operators other than redirects. */
function segments(tokens) {
  const out = [];
  let cur = [];
  for (const t of tokens) {
    if (t.op && !['>', '>>', '<', '>&', '&>', '<<', 'heredoc-end'].includes(t.op)) {
      if (cur.length) out.push(cur);
      cur = [];
    } else cur.push(t);
  }
  if (cur.length) out.push(cur);
  return out;
}

const WRITES_FILE = /\b(writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|fs\.write|copyFileSync|write_text|write_bytes)\b|\bopen\s*\([^)]*,\s*['"][wax]b?\+?['"]|\.write\s*\(/;

/** The reason a command is blocked, or null. */
export function check(command) {
  const tokens = tokenize(command);

  // 1. Chaining.
  const sep = tokens.find((t) => t.op === '&&' || t.op === '||' || t.op === ';');
  if (sep) return `chained commands ("${sep.op}"): run one command per Bash call (${RULE}).`;
  const trimmedTokens = tokens.filter((t, k) => !(t.op === '\n' && (k === tokens.length - 1 || k === 0)));
  const nlAt = trimmedTokens.findIndex((t) => t.op === '\n');
  if (nlAt !== -1 && trimmedTokens.slice(nlAt + 1).some((t) => t.word !== undefined))
    return `two commands on separate lines: run one command per Bash call (${RULE}).`;

  const segs = segments(tokens);
  const heredoc = tokens.some((t) => t.op === '<<');
  for (const seg of segs) {
    const words = seg.filter((t) => t.word !== undefined);
    // 2. Leading assignment.
    if (words[0] && !words[0].quoted && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0].word))
      return `leading assignment "${words[0].word.split('=')[0]}=…": no VAR=x cmd; use the environment or \`env -u\` (${RULE}).`;
    if (words[0]?.word === 'env') {
      for (const w of words.slice(1)) {
        if (w.word === '-u' || w.word.startsWith('--unset')) continue;
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w.word)) return `"env ${w.word.split('=')[0]}=…" sets a variable for one command: no VAR=x cmd (${RULE}).`;
        if (!w.word.startsWith('-')) break;
      }
    }
    // 3. Redirect or tee into a code file.
    for (let k = 0; k < seg.length; k++) {
      const t = seg[k];
      if ((t.op === '>' || t.op === '>>' || t.op === '&>') && seg[k + 1]?.word !== undefined && CODE_FILE.test(seg[k + 1].word))
        return `${heredoc ? 'heredoc ' : ''}redirect into ${seg[k + 1].word}: write TypeScript, JavaScript and Python with the file tools (${RULE}).`;
    }
    const cmd = words[0]?.word.replace(/^.*[\\/]/, '').replace(/\.exe$/i, '');
    if (cmd === 'tee') {
      const target = words.slice(1).find((w) => !w.word.startsWith('-') && CODE_FILE.test(w.word));
      if (target) return `tee into ${target.word}: write code files with the file tools (${RULE}).`;
    }
    // 4. In-place edits.
    if (cmd === 'sed' || cmd === 'perl') {
      const inPlace = words.slice(1).some((w) => w.word === '--in-place' || w.word.startsWith('--in-place=') || /^-[A-Za-z]*i/.test(w.word));
      const target = words.slice(1).find((w) => CODE_FILE.test(w.word));
      if (inPlace && target) return `${cmd} in-place edit of ${target.word}: edit code files with the file tools (${RULE}).`;
    }
    // 5. node -e / python -c that writes a file.
    if (cmd === 'node' || /^python(\d+(\.\d+)?)?$/.test(cmd ?? '') || cmd === 'py') {
      const flagAt = words.findIndex((w) => (cmd === 'node' ? ['-e', '--eval', '-p', '--print'] : ['-c']).includes(w.word));
      const code = flagAt > 0 ? words[flagAt + 1]?.word : undefined;
      if (code && WRITES_FILE.test(code)) return `${cmd} ${words[flagAt].word} code that writes a file: write files with the file tools (${RULE}).`;
    }
  }
  return null;
}

// Hook entry point: JSON on stdin, { tool_input: { command } }.
//
// Order 7 (ITEM 1.2): fail closed. Claude Code lets the call go ahead on any exit code other than 2, so every
// failure of our own (unreadable stdin, input that is not hook JSON, no command string, an exception, a crash)
// exits 2 with the reason. What this script cannot cover: node failing to start at all. Order 8: .claude/settings.json
// sets `onFailure: "block"` for that (Claude Code v2.1.295+; the VS Code extension here is 2.1.301). Tested in a
// child `claude -p --settings` (2.1.301): an unstartable hook command fails open without it and blocks with it.
// The older CLI on PATH (2.1.278) accepts the key and runs the hook as before.
// Recovery when a broken hook blocks every Bash call: README.md, "If the Bash hook blocks everything".
const failClosed = (why) => {
  process.stderr.write(`Blocked by .claude/hooks/check-bash.mjs: the hook could not check this command (${why}), so it blocks it. See README.md, "If the Bash hook blocks everything".\n`);
  process.exit(2);
};
process.on('uncaughtException', (e) => failClosed(`error: ${e?.message ?? e}`));
{
  let input = '';
  try {
    input = readFileSync(0, 'utf8');
  } catch (e) {
    failClosed(`stdin unreadable: ${e?.message ?? e}`);
  }
  let command;
  try {
    command = JSON.parse(input)?.tool_input?.command;
  } catch {
    failClosed('input is not hook JSON');
  }
  if (typeof command !== 'string') failClosed('no tool_input.command string');
  if (process.env.CHECK_BASH_FAULT === '1') throw new Error('injected fault (test only)');
  const reason = check(command);
  if (reason) {
    process.stderr.write(`Blocked by .claude/hooks/check-bash.mjs: ${reason}\n`);
    process.exit(2);
  }
  process.exit(0);
}
