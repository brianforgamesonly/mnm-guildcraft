// Tests for check-bash.mjs (work order 3, ITEM 4): each command is piped in as hook JSON, as Claude Code
// sends it, and the exit code is checked (2 = blocked, 0 = allowed). Run: node --test .claude/hooks/
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('./check-bash.mjs', import.meta.url));
const run = (command) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8' });

// [command, expected: 'block' | 'allow', why]
const TABLE = [
  // 1. chaining
  ['npm ci && npm test', 'block', '&&'],
  ['git fetch || true', 'block', '||'],
  ['cd src; ls', 'block', ';'],
  ['git status\ngit diff', 'block', 'two commands on two lines'],
  ['find . -name "*.tmp" -exec rm {} \\;', 'allow', 'escaped \\; in find -exec'],
  ["echo 'a && b; c || d'", 'allow', 'separators inside single quotes'],
  ['git commit -m "fix: a; b && c"', 'allow', 'separators inside double quotes'],
  ['gh run list --json databaseId | jq ".[0]"', 'allow', 'a pipe'],
  ['npx vitest run 2>&1 | tail -5', 'allow', '2>&1 and a pipe'],
  ['gh api repos/x/y \\\n  --jq ".name"', 'allow', 'a line continuation'],
  // 2. leading assignment
  ['NODE_ENV=test npm test', 'block', 'VAR=x cmd'],
  ['FOO=1 BAR=2 node x.js', 'block', 'two assignments'],
  ['env CLOUDFLARE_API_TOKEN=x wrangler whoami', 'block', 'env VAR=x cmd'],
  ['env -u GITHUB_TOKEN gh auth status', 'allow', 'the order-1 env -u form'],
  ['git log --format="A=%an"', 'allow', 'an = inside an argument'],
  // 3. writing code files
  ["cat <<'EOF' > src/x.ts\nexport const a = 1;\nEOF", 'block', 'heredoc into .ts'],
  ['cat > scripts/run.py <<EOF\nprint(1)\nEOF', 'block', 'heredoc into .py (redirect first)'],
  ['echo "x" > src/app.js', 'block', '> into .js'],
  ['echo "x" >> lib/a.mjs', 'block', '>> into .mjs'],
  ['printf "%s" x | tee src/a.ts', 'block', 'tee into .ts'],
  ['printf "%s" x | tee -a src/a.ts', 'block', 'tee -a into .ts'],
  ['gh run list --json databaseId,status > runs.json', 'allow', '> file.json saving output'],
  ["npx wrangler d1 execute db --local --command \"SELECT 1;\"", 'allow', 'SQL in a quoted argument'],
  ["sqlite3 x.db <<'SQL'\nCREATE TABLE a (b);\nINSERT INTO a VALUES (1);\nSQL", 'allow', 'heredoc carrying SQL'],
  ["bash <<'SH'\necho one; echo two\nSH", 'allow', 'heredoc carrying shell'],
  ['node build.js > out.txt', 'allow', 'running a .js file, output to .txt'],
  // 4. in-place edits
  ["sed -i 's/a/b/' src/x.ts", 'block', 'sed -i'],
  ["sed --in-place 's/a/b/' src/x.ts", 'block', 'sed --in-place'],
  ["sed -i.bak 's/a/b/' scripts/a.py", 'block', 'sed -i.bak'],
  ["sed -Ei 's/a/b/' src/x.ts", 'block', 'sed -Ei'],
  ["perl -pi -e 's/a/b/' src/x.js", 'block', 'perl -pi'],
  ["perl -i -pe 's/a/b/' src/x.mjs", 'block', 'perl -i'],
  ["sed -n '1,20p' src/x.ts", 'allow', 'sed reading a .ts file'],
  ["sed -i 's/a/b/' notes.md", 'allow', 'sed -i on a non-code file'],
  // 5. node -e / python -c writing files
  ["node -e \"require('fs').writeFileSync('a.ts', 'x')\"", 'block', 'node -e writeFileSync'],
  ["node --eval \"fs.appendFileSync('a.txt', 'x')\"", 'block', 'node --eval appendFileSync'],
  ["python -c \"open('a.py', 'w').write('x')\"", 'block', 'python -c open(w)'],
  ["python3 -c \"import pathlib; pathlib.Path('a.ts').write_text('x')\"", 'block', 'python3 -c write_text'],
  ["node -e \"console.log(process.version)\"", 'allow', 'node -e without a write'],
  ["python -c \"print(1 + 1)\"", 'allow', 'python -c without a write'],
  // Order 7 (ITEM 1.2): order 6's first command, verbatim from that session's transcript (its wireToolInputs).
  // The hook blocks it when it receives it. Claude Code did not pass it on as written: it rewrote a leading
  // `cd <the current directory> &&` into the call's working directory and sent the hook "git fetch origin 2>&1 | tail -2".
  ['cd /c/Users/bmatt/Projects/mnm-guildcraft && git fetch origin 2>&1 | tail -2', 'block', "order 6's first command, as written"],
  ['git fetch origin 2>&1 | tail -2', 'allow', 'the same command as Claude Code passed it to the hook'],
  ['cd /c/Users/bmatt/Projects/mnm-guildcraft/.claude/worktrees/order-04 && git ls-files | grep -v \'^data/\' | head -100', 'block', 'order 5: a cd into another directory reaches the hook whole'],
];

test(`hook table: ${TABLE.length} commands`, () => {
  const rows = [];
  for (const [command, expected, why] of TABLE) {
    const r = run(command);
    const got = r.status === 2 ? 'block' : r.status === 0 ? 'allow' : `exit ${r.status}`;
    rows.push({ command: command.replace(/\n/g, '⏎'), expected, got, why, reason: r.stderr.trim() });
    assert.equal(got, expected, `${why}: ${command}\n${r.stderr}`);
    if (got === 'block') assert.match(r.stderr, /^Blocked by \.claude\/hooks\/check-bash\.mjs: /);
  }
  if (process.env.HOOK_TABLE) console.log(JSON.stringify(rows, null, 1));
});

// Order 7: fail closed. Each failure of the hook's own exits 2 (Claude Code blocks only on 2).
for (const [why, input] of [
  ['input that is not JSON', 'not json'],
  ['empty input', ''],
  ['JSON without tool_input.command', JSON.stringify({ tool_name: 'Bash', tool_input: {} })],
  ['a command that is not a string', JSON.stringify({ tool_name: 'Bash', tool_input: { command: 42 } })],
])
  test(`fails closed: ${why}`, () => {
    const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /could not check this command/);
  });

test('fails closed: an exception inside the check', () => {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_input: { command: 'ls' } }), encoding: 'utf8', env: { ...process.env, CHECK_BASH_FAULT: '1' } });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /injected fault/);
});
