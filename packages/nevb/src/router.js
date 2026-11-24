export function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function splitPath(pathname) {
  return pathname.split('/').filter(Boolean).map(safeDecode);
}

export function compile(pattern) {
  return pattern
    .split('/')
    .filter(Boolean)
    .map((s) => {
      if (s[0] === ':') {
        const optional = s.endsWith('?');
        return { t: 'param', name: optional ? s.slice(1, -1) : s.slice(1), optional };
      }
      if (s[0] === '*') return { t: 'wild', name: s.slice(1) || '*' };
      return { t: 'static', v: s };
    });
}

export function matchSegs(segs, parts, prefix = false) {
  const params = {};
  let i = 0;
  for (const s of segs) {
    if (s.t === 'wild') {
      params[s.name] = parts.slice(i).join('/');
      return params;
    }
    if (s.t === 'static') {
      if (parts[i] !== s.v) return null;
      i++;
    } else if (i >= parts.length) {
      if (s.optional) continue;
      return null;
    } else {
      params[s.name] = parts[i++];
    }
  }
  return prefix || i === parts.length ? params : null;
}
