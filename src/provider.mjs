export async function sendToClaude(tenant, messages, fetcher = fetch) {
  // Destination, credentials, organization and model are operator-owned, never client-controlled.
  const response = await fetcher('https://api.anthropic.com/v1/messages', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { 'content-type': 'application/json', 'x-api-key': tenant.provider.apiKey,
      'anthropic-version': '2023-06-01', 'anthropic-allowed-org-ids': tenant.provider.orgIds.join(',') },
    body: JSON.stringify({ model: tenant.provider.model, max_tokens: 1024, messages })
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error('PROVIDER_FAILURE'); }
  const reader = response.body.getReader();
  let bytes = 0;
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 128000) { await reader.cancel(); throw new Error('PROVIDER_RESPONSE_TOO_LARGE'); }
    chunks.push(value);
  }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!Array.isArray(data.content)) throw new Error('PROVIDER_FAILURE');
  const text = data.content.filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n');
  if (!text || text.length > 64000) throw new Error('PROVIDER_FAILURE');
  return text;
}
