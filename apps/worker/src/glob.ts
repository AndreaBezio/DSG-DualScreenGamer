/** Minimal case-insensitive glob for release asset names: `*`, `?` and `{a,b}`. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') re += '.*';
    else if (c === '?') re += '.';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) re += '\\{';
      else {
        re += `(?:${glob.slice(i + 1, end).split(',').map(escape).join('|')})`;
        i = end;
      }
    } else re += escape(c);
  }
  return new RegExp(`^${re}$`, 'i');
}

function escape(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

export function matchesGlob(name: string, glob: string): boolean {
  return globToRegExp(glob).test(name);
}
