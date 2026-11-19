const $ = id => document.getElementById(id);
let session;
let bootstrap;
const labels = { PESEL:'PESEL', PAYMENT_CARD:'Numer karty', IBAN:'Rachunek bankowy', EMAIL:'Adres e-mail', PERSONAL_NUMBER:'Numer osobowy / telefon', SECRET:'Hasło lub sekret', CONFIDENTIAL_LABEL:'Oznaczenie poufności', OPAQUE_ENCODING:'Zakodowana treść' };
const errors = { LOGIN_REQUIRED:'Sesja wygasła. Zaloguj się ponownie.', EGRESS_DISABLED:'Wysyłanie do AI jest wyłączone. Treść pozostała w bramie.', PROVIDER_FAILED:'Dostawca AI jest niedostępny. Żądanie mogło dotrzeć do dostawcy; nie ponawiaj go automatycznie.', RATE_LIMIT:'Osiągnięto limit żądań. Odczekaj minutę.', CONCURRENT_LIMIT:'Poprzednie żądanie jest nadal przetwarzane.', INVALID_MESSAGES:'Nieprawidłowa wiadomość lub przekroczony limit.', GATE_UNAVAILABLE:'Brama jest niedostępna. Wysyłanie zatrzymano.', CSRF_DENIED:'Nieprawidłowa sesja formularza. Odśwież stronę.', ADMIN_REQUIRED:'Dostęp do audytu wymaga roli administratora.' };
async function api(path, body) {
  const response = await fetch(path, { method:body === undefined ? 'GET':'POST', credentials:'same-origin', cache:'no-store',
    headers:body === undefined ? {} : { 'Content-Type':'application/json', 'X-CSRF-Token':session?.csrf || '' },
    body:body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (response.status === 401) { session = undefined; render(); }
  return { ok:response.ok, ...data };
}
function showError(message) { $('global-error').textContent = message; $('global-error').hidden = false; }
function view(name) {
  for (const id of ['login','workspace','policy','audit']) $(`${id}-view`).hidden = id !== name;
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === name));
}
function render() {
  $('tenant-badge').textContent = session ? `${session.tenant.name}${session.demo ? ' · DEMO' : ''}` : 'Brak sesji';
  $('logout').hidden = !session;
  $('audit-nav').hidden = !session?.admin;
  if (session) {
    view('workspace');
    $('connection-status').textContent = session.externalEnabled ? 'DOSTAWCA WŁĄCZONY' : 'TYLKO KONTROLA LOKALNA';
    $('send').disabled = !session.externalEnabled;
    $('send').title = session.externalEnabled ? '' : 'Wysyłanie do AI jest wyłączone';
  } else view('login');
}
async function refreshSession() {
  const data = await api('/api/session');
  session = data.ok ? data : undefined;
  render();
}
$('login').addEventListener('click', async () => {
  const tenant = $('tenant-select').value;
  if (!tenant) return;
  if (!bootstrap.demo) { location.assign(`/auth/login/${encodeURIComponent(tenant)}`); return; }
  try {
    const result = await api(`/auth/demo/${encodeURIComponent(tenant)}`, {});
    if (!result.ok) throw new Error('Nie udało się utworzyć sesji demonstracyjnej.');
    await refreshSession();
  } catch (error) { showError(error.message); }
});
$('logout').addEventListener('click', async () => {
  try {
    const data = await api('/auth/logout', {});
    if (!data.ok) throw new Error(errors[data.code] || 'Wylogowanie nie powiodło się.');
    session = undefined; $('prompt').value = ''; $('reply-text').textContent = ''; $('reply').hidden = true;
    $('result').hidden = true; $('events').replaceChildren(); $('char-count').textContent = '0 / 12 000'; render();
  } catch (error) { showError(error.message); }
});
$('prompt').addEventListener('input', () => { $('char-count').textContent = `${$('prompt').value.length.toLocaleString('pl')} / 12 000`; $('result').hidden = true; });
async function submit(path) {
  const content = $('prompt').value;
  if (!content.trim()) { $('prompt').focus(); return; }
  $('global-error').hidden = true; $('check').disabled = true; $('send').disabled = true;
  $('result').hidden = true; $('reply').hidden = true; $('reply-text').textContent = '';
  try {
    const data = await api(path, { messages:[{ role:'user', content }] });
    const result = $('result'); result.className = data.ok ? '' : 'blocked'; result.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = data.code === 'DLP_BLOCKED' ? 'Wysyłanie zablokowane' : data.code === 'RESPONSE_BLOCKED' ? 'Odpowiedź zatrzymana przez filtr' : data.ok ? (data.reply ? 'Wiadomość wysłana przez bramę' : 'Nie wykryto zdefiniowanych wzorców') : 'Żądanie zatrzymane';
    const description = document.createElement('div');
    description.textContent = data.categories ? data.categories.map(c => labels[c] || c).join(', ') : data.ok ? (data.reply ? 'Odpowiedź sprawdzono przed wyświetleniem.' : 'Kontrola lokalna zakończona. Treść nie została wysłana do Claude. Wynik nie zastępuje klasyfikacji informacji.') : errors[data.code] || 'Żądanie odrzucone przez politykę bezpieczeństwa.';
    const reference = document.createElement('small'); reference.textContent = `Identyfikator: ${data.requestId || 'brak'}`;
    result.append(title, description, reference); result.hidden = false;
    if (data.reply) { $('reply-text').textContent = data.reply; $('reply').hidden = false; }
  } catch { showError('Brak połączenia z bramą. Nie ponawiaj wysłania automatycznie.'); }
  finally { $('check').disabled = false; $('send').disabled = !session?.externalEnabled; }
}
$('check').addEventListener('click', () => submit('/api/check'));
$('send').addEventListener('click', () => submit('/api/chat'));
async function audit() {
  try {
    const data = await api('/api/events');
    if (!data.ok) throw new Error(errors[data.code] || 'Nie można pobrać audytu.');
    $('events').replaceChildren();
    for (const event of data.events) {
      const row = document.createElement('tr');
      for (const value of [new Date(event.at).toLocaleString('pl-PL'), event.decision, event.categories.map(c => labels[c] || c).join(', ') || '—', event.requestId]) {
        const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
      }
      $('events').append(row);
    }
    if (!data.events.length) { const row = document.createElement('tr'); const cell = document.createElement('td'); cell.colSpan=4; cell.textContent='Brak zdarzeń w tej organizacji.'; row.append(cell); $('events').append(row); }
  } catch (error) { showError(error.message); }
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  const name = button.dataset.view;
  if (!session && name !== 'policy') { view('login'); return; }
  view(name); if (name === 'audit') audit();
}));
$('refresh-audit').addEventListener('click', audit);
try {
  bootstrap = await api('/api/bootstrap');
  if (!bootstrap.ok) throw new Error('Nie można odczytać konfiguracji bramy.');
  for (const tenant of bootstrap.tenants) { const option = document.createElement('option'); option.value=tenant.id; option.textContent=tenant.name; $('tenant-select').append(option); }
  if (bootstrap.demo) {
    $('mode-banner').textContent = 'DEMO LOKALNE · Tożsamości są symulowane. Żadne dane nie trafiają do Claude. Ten podgląd nie wdraża blokad na urządzeniach ani w sieci.';
    $('mode-banner').hidden = false; $('login').textContent = 'Otwórz demo organizacji';
    $('login-hint').textContent = 'Wybór organizacji tworzy syntetyczną sesję demonstracyjną. W produkcji dostęp zapewnia wyłącznie firmowe SSO.';
  }
  await refreshSession();
} catch (error) { showError(error.message); }
