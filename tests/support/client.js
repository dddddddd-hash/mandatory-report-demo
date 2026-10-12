export function sessionClient(base) {
  const cookies = new Map();
  const client = async (url, options = {}) => {
    const headers = new Headers(options.headers);
    if (cookies.size) headers.set("Cookie", [...cookies].map(([name, value]) => name + "=" + value).join("; "));
    const response = await globalThis.fetch(new URL(url, base), { ...options, headers });
    for (const value of response.headers.getSetCookie()) { const [name, token] = value.split(";")[0].split("="); if (token) cookies.set(name, token); else cookies.delete(name); }
    return response;
  };
  client.cookie = () => [...cookies].map(([name, value]) => name + "=" + value).join("; ");
  return client;
}
