// Copy captured output into this record as UTF-8 without a byte-order mark, with the profile path,
// the user name, the machine name and Windows SIDs replaced (also in JSON-escaped form), and
// terminal colour codes removed. Adapted from the PR #417 record's helper.
//
// Usage: node redact-copy.mjs <source> <destination> [<source> <destination> ...]
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';

const user = homedir().split(/[\\/]/).at(-1);
// C:\Users\<user>, C:/Users/<user>, C:\\Users\\<user> and /c/Users/<user>, in any letter case.
const profile = new RegExp(`(?:[a-z]:|/[a-z])(?:\\\\|/)+users(?:\\\\|/)+${user}`, 'gi');
// A wrapped line can split the drive letter from the rest of the path.
const wrapped = new RegExp(`(?:\\\\|/)+users(?:\\\\|/)+${user}`, 'gi');
const pairs = process.argv.slice(2);
for (let index = 0; index + 1 < pairs.length; index += 2) {
  const text = readFileSync(pairs[index], 'utf8')
    .replace(/^\uFEFF/, '')
    .replace(profile, '%USERPROFILE%')
    .replace(wrapped, '%USERPROFILE%')
    .replace(new RegExp(user, 'gi'), '%USERNAME%')
    .replace(new RegExp(hostname(), 'gi'), '%COMPUTERNAME%')
    .replace(/S-1-5-21-[0-9-]+/g, '<SID>')
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*m/g, '');
  writeFileSync(pairs[index + 1], text, 'utf8');
}
