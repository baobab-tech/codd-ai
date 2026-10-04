export const UA = "codd-ai/0.1 (+https://github.com/baobab-tech/codd-ai; open data indexer)";
// Used only to test whether a block is UA-based; recorded as such in probes.
export const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export interface FetchResult {
  url: string;
  status: number;
  final_url: string | null;
  content_type: string | null;
  server: string | null;
  blocked: string | null;
  ms: number;
  error: string | null;
  body: string;
  headers: Record<string, string>;
}

const MAX_BODY = 2_000_000;

/** GET with timeout; never throws. `blocked` names the bot-protection signature, if any. */
export async function fetchText(url: string, opts: { ua?: string; timeoutMs?: number; accept?: string } = {}): Promise<FetchResult> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      headers: { "user-agent": opts.ua ?? UA, accept: opts.accept ?? "text/html,application/json;q=0.9,*/*;q=0.8" },
    });
    const headers = Object.fromEntries(res.headers.entries());
    let body = "";
    if (res.body) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      while (body.length < MAX_BODY) {
        const { done, value } = await reader.read();
        if (done) break;
        body += dec.decode(value, { stream: true });
      }
      reader.cancel().catch(() => {});
    }
    return {
      url,
      status: res.status,
      final_url: res.url !== url ? res.url : null,
      content_type: headers["content-type"] ?? null,
      server: headers["server"] ?? null,
      blocked: detectBlock(res.status, headers, body),
      ms: Date.now() - t0,
      error: null,
      body,
      headers,
    };
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    return { url, status: 0, final_url: null, content_type: null, server: null, blocked: null, ms: Date.now() - t0, error: err.cause?.code ?? err.name + ": " + err.message, body: "", headers: {} };
  }
}

function detectBlock(status: number, h: Record<string, string>, body: string): string | null {
  const head = body.slice(0, 20_000);
  // AWS WAF bot control answers 202 with an empty challenge page (seen on donneesquebec.ca under bursts).
  if (status === 202 && (/awselb/.test(h["server"] ?? "") || h["x-amzn-waf-action"])) return "aws_waf_challenge";
  if (h["cf-mitigated"] === "challenge" || /cdn-cgi\/challenge-platform|Just a moment\.\.\./.test(head)) return "cloudflare_challenge";
  if (/_Incapsula_Resource|incap_ses/.test(head) || h["x-iinfo"]) return status >= 400 || head.length < 5000 ? "imperva" : null;
  if (/akamai/i.test(h["server"] ?? "") && status === 403) return "akamai_403";
  if (/Request unsuccessful\. Incapsula|Access Denied.*Reference #/s.test(head)) return "waf_denied";
  if (/sgcaptcha|captcha-delivery|hcaptcha|g-recaptcha/.test(head) && status >= 400) return "captcha";
  if (status === 403 || status === 429) return `http_${status}`;
  return null;
}

export function json<T = any>(r: FetchResult): T | null {
  if (r.status !== 200) return null;
  try {
    return JSON.parse(r.body) as T;
  } catch {
    return null;
  }
}
