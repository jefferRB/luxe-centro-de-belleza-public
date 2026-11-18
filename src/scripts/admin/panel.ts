/** LUXE photo panel (browser side). The server checks every request; this script only
 * renders the state it receives and sends one change at a time. All text from the state is
 * inserted with textContent, never as HTML. */

type Section = 'portada' | 'trabajos' | 'espacio' | 'fachada';
type Tab = Section | 'globe';

interface Photo {
  id: string; section: Section; origin: 'catalogo' | 'subida'; alt: string; title: string;
  category?: string; area?: string; removed: boolean; replaced: boolean; editableTitle: boolean; thumb: string;
}
interface GlobeSelection { id: string; name: string; category: string; ids: string[]; automatic: boolean }
interface Publish { state: 'idle' | 'building' | 'error' | 'preview'; publishedRevision: number | null; publishedAt: string | null; error: string | null }
interface State {
  revision: number;
  sections: Record<Section, Photo[]>;
  globe: GlobeSelection[];
  categories: { id: string; label: string }[];
  limits: { alt: { min: number; max: number }; title: { min: number; max: number }; area: { min: number; max: number }; globePerSpecialty: number; spaceStops: { min: number; max: number }; works: { min: number; max: number } };
  publish: Publish;
}

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const MAX_BYTES = 15 * 1024 * 1024;
const MIN_SIDE = 600;

class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';

async function api<T>(path: string, init: { method?: string; json?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-CSRF-Token': csrf };
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(path, { method: init.method ?? 'GET', headers, body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined), credentials: 'same-origin' });
  } catch {
    throw new ApiError('No hay conexión con el servidor. Revisá tu internet e intentá de nuevo.', 0);
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new ApiError(body.error ?? 'No se pudo completar la acción.', response.status);
  return body as T;
}

/** Element helper: attributes and text only (no HTML strings). */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | undefined> = {}, ...children: (Node | string | false | null | undefined)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (name === 'class') node.className = value as string;
    else node.setAttribute(name, value === true ? '' : value);
  }
  for (const child of children) if (child !== false && child !== null && child !== undefined) node.append(child);
  return node;
}

// ——— Sign in ———

const loginForm = document.querySelector<HTMLFormElement>('[data-login]');
if (loginForm) {
  const error = loginForm.querySelector<HTMLElement>('[data-login-error]')!;
  const button = loginForm.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(loginForm);
    const username = String(data.get('username') ?? '').trim();
    const password = String(data.get('password') ?? '');
    if (!username || !password) { error.textContent = 'Escribí tu usuario y tu contraseña.'; error.hidden = false; return; }
    button.disabled = true;
    button.textContent = 'Verificando…';
    error.hidden = true;
    try {
      await api('/admin/api/session', { method: 'POST', json: { username, password } });
      location.reload();
    } catch (failure) {
      error.textContent = (failure as Error).message;
      error.hidden = false;
      loginForm.querySelector<HTMLInputElement>('input[name="password"]')!.value = '';
      button.disabled = false;
      button.textContent = 'Ingresar';
    }
  });
}

// ——— Panel ———

const stateNode = document.getElementById('admin-state');
if (stateNode && csrf) startPanel(JSON.parse(stateNode.textContent ?? '{}') as State);

function startPanel(initial: State) {
  let state = initial;
  const panel = document.querySelector<HTMLElement>('[data-panel]')!;
  const publishNode = document.querySelector<HTMLElement>('[data-publish]')!;
  const toasts = document.querySelector<HTMLElement>('[data-toasts]')!;
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-tab]')];
  const isTab = (value: string): value is Tab => tabs.some((tab) => tab.dataset.tab === value);
  let tab: Tab = isTab(location.hash.slice(1)) ? location.hash.slice(1) as Tab : 'portada';
  let filter = 'all';
  const orderDraft: Partial<Record<'trabajos' | 'espacio', string[]>> = {};
  const globeDraft: Record<string, string[]> = {};
  let polling: number | undefined;

  const categoryLabel = (id?: string) => state.categories.find((category) => category.id === id)?.label ?? '';
  const active = (section: Section) => state.sections[section].filter((photo) => !photo.removed);
  const retired = (section: Section) => state.sections[section].filter((photo) => photo.removed);

  function toast(message: string, kind: 'ok' | 'error' = 'ok') {
    const node = h('p', { class: `admin-toast admin-toast--${kind}` }, message);
    toasts.append(node);
    setTimeout(() => node.remove(), kind === 'error' ? 8000 : 4500);
  }

  function handleFailure(error: unknown) {
    const failure = error as ApiError;
    if (failure.status === 401) { toast('Tu sesión terminó. Ingresá de nuevo.', 'error'); setTimeout(() => location.reload(), 1500); return; }
    toast(failure.message, 'error');
    if (failure.status === 409) void refresh();
  }

  async function refresh() {
    try { apply(await api<State>('/admin/api/photos')); } catch (error) { handleFailure(error); }
  }

  function apply(next: State) {
    state = next;
    for (const key of Object.keys(orderDraft) as ('trabajos' | 'espacio')[]) delete orderDraft[key];
    for (const key of Object.keys(globeDraft)) delete globeDraft[key];
    render();
    watchPublish();
  }

  // ——— Publish status ———

  function renderPublish() {
    const { publish, revision } = state;
    publishNode.replaceChildren();
    let text: string;
    let kind = 'ok';
    let retry = false;
    if (publish.state === 'preview') { text = 'Vista local: recargá el sitio para ver los cambios'; kind = 'muted'; }
    else if (publish.state === 'building') { text = 'Publicando cambios…'; kind = 'busy'; }
    else if (publish.state === 'error') { text = 'No se pudo publicar. La versión anterior sigue en línea.'; kind = 'error'; retry = true; }
    else if (publish.publishedRevision !== null && publish.publishedRevision < revision) { text = 'Hay cambios sin publicar'; kind = 'warn'; retry = true; }
    else {
      const time = publish.publishedAt ? new Date(publish.publishedAt).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' }) : '';
      text = time ? `Publicado · ${time}` : 'Sitio publicado';
    }
    publishNode.append(h('span', { class: `admin-pill admin-pill--${kind}` }, text));
    if (retry) {
      const button = h('button', { type: 'button', class: 'admin-link' }, publish.state === 'error' ? 'Reintentar' : 'Publicar');
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { state.publish = await api<Publish>('/admin/api/publish', { method: 'POST', json: {} }); renderPublish(); watchPublish(); }
        catch (error) { handleFailure(error); button.disabled = false; }
      });
      publishNode.append(button);
    }
  }

  function watchPublish() {
    window.clearTimeout(polling);
    if (state.publish.state !== 'building') return;
    polling = window.setTimeout(async () => {
      try {
        const before = state.publish.state;
        state.publish = await api<Publish>('/admin/api/publish');
        renderPublish();
        if (before === 'building' && state.publish.state === 'idle') toast('Cambios publicados en la página.');
        if (state.publish.state === 'error') toast(state.publish.error ?? 'No se pudo publicar.', 'error');
      } catch (error) { handleFailure(error); }
      watchPublish();
    }, 2500);
  }

  // ——— Dialogs ———

  function openDialog(options: { title: string; body: Node[]; confirm: string; danger?: boolean; onConfirm: () => Promise<boolean | void> }) {
    const error = h('p', { class: 'admin-error', role: 'alert', hidden: true });
    const confirm = h('button', { type: 'submit', class: `admin-button ${options.danger ? 'admin-button--danger' : 'admin-button--gold'}` }, options.confirm);
    const cancel = h('button', { type: 'button', class: 'admin-button' }, 'Cancelar');
    const form = h('form', { method: 'dialog', class: 'admin-dialog__form' }, h('h2', {}, options.title), ...options.body, error, h('div', { class: 'admin-dialog__actions' }, cancel, confirm));
    const dialog = h('dialog', { class: 'admin-dialog', 'aria-label': options.title }, form);
    document.body.append(dialog);
    const close = () => { dialog.close(); dialog.remove(); };
    cancel.addEventListener('click', close);
    // Escape closes, except while a change is being saved.
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); if (!confirm.disabled) close(); });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.hidden = true;
      confirm.disabled = true;
      cancel.disabled = true;
      const label = confirm.textContent;
      confirm.textContent = 'Guardando…';
      try {
        const keepOpen = await options.onConfirm();
        if (!keepOpen) close();
      } catch (failure) {
        const apiError = failure as ApiError;
        if (apiError.status === 401 || apiError.status === 409) { close(); handleFailure(failure); return; }
        error.textContent = apiError.message;
        error.hidden = false;
      } finally {
        confirm.disabled = false;
        cancel.disabled = false;
        confirm.textContent = label;
      }
    });
    dialog.showModal();
    return { dialog, error };
  }

  function textField(label: string, name: string, value: string, limits: { min: number; max: number }, multiline = false) {
    const input = multiline
      ? h('textarea', { name, rows: '3', required: true, minlength: String(limits.min), maxlength: String(limits.max) })
      : h('input', { name, required: true, minlength: String(limits.min), maxlength: String(limits.max) });
    input.value = value;
    const count = h('span', { class: 'admin-count', 'aria-hidden': 'true' });
    const update = () => { count.textContent = `${input.value.trim().length}/${limits.max}`; };
    input.addEventListener('input', update);
    update();
    return { node: h('label', { class: 'admin-field' }, h('span', {}, label, count), input), input };
  }

  /** File picker with a local preview and the same checks the server repeats. */
  function photoPicker(current?: Photo) {
    const input = h('input', { type: 'file', name: 'photo', accept: ACCEPTED.join(','), required: true, class: 'admin-file__input' });
    const preview = h('img', { alt: '', class: 'admin-preview__img', hidden: true });
    const empty = h('span', { class: 'admin-preview__empty' }, 'Elegí una fotografía para previsualizarla');
    const info = h('p', { class: 'admin-muted admin-file__info' }, 'JPG, PNG, WebP o AVIF · hasta 15 MB · mínimo 600 px por lado.');
    let ok = false;
    input.addEventListener('change', async () => {
      ok = false;
      const file = input.files?.[0];
      if (preview.src) URL.revokeObjectURL(preview.src);
      preview.hidden = true;
      empty.hidden = false;
      if (!file) return;
      if (!ACCEPTED.includes(file.type)) { info.textContent = 'Formato no admitido. Usá JPG, PNG, WebP o AVIF.'; info.classList.add('admin-error'); return; }
      if (file.size > MAX_BYTES) { info.textContent = 'La fotografía supera los 15 MB.'; info.classList.add('admin-error'); return; }
      const url = URL.createObjectURL(file);
      preview.src = url;
      try { await preview.decode(); } catch { info.textContent = 'No se pudo leer la fotografía.'; info.classList.add('admin-error'); return; }
      const { naturalWidth: width, naturalHeight: height } = preview;
      if (Math.min(width, height) < MIN_SIDE) { info.textContent = `La fotografía es muy pequeña (${width}×${height} px).`; info.classList.add('admin-error'); return; }
      info.classList.remove('admin-error');
      info.textContent = `${file.name} · ${width}×${height} px · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
      preview.hidden = false;
      empty.hidden = true;
      ok = true;
    });
    const label = h('label', { class: 'admin-file' }, h('span', { class: 'admin-button' }, 'Elegir fotografía'), input);
    const compare = current
      ? h('div', { class: 'admin-compare' },
        h('figure', {}, h('img', { src: current.thumb, alt: '' }), h('figcaption', {}, 'Actual')),
        h('figure', {}, h('div', { class: 'admin-preview' }, preview, empty), h('figcaption', {}, 'Nueva')))
      : h('div', { class: 'admin-preview admin-preview--single' }, preview, empty);
    return { nodes: [compare, label, info], input, valid: () => ok };
  }

  const confirmed = (next: State, message: string) => { apply(next); toast(message); };

  function uploadDialog(section: 'trabajos' | 'espacio') {
    const picker = photoPicker();
    const title = textField(section === 'trabajos' ? 'Título breve' : 'Título del ambiente', 'title', '', state.limits.title);
    const alt = textField('Texto alternativo (qué se ve en la foto)', 'alt', '', state.limits.alt, true);
    const extra = section === 'trabajos'
      ? (() => {
        const select = h('select', { name: 'category', required: true }, h('option', { value: '' }, 'Elegí una especialidad'), ...state.categories.map((category) => h('option', { value: category.id, selected: filter === category.id }, category.label)));
        return { node: h('label', { class: 'admin-field' }, h('span', {}, 'Especialidad'), select), value: () => select.value, name: 'category' };
      })()
      : (() => { const area = textField('Ambiente (por ejemplo: Barbería)', 'area', '', state.limits.area); return { node: area.node, value: () => area.input.value, name: 'area' }; })();
    openDialog({
      title: section === 'trabajos' ? 'Subir un trabajo' : 'Agregar un ambiente',
      body: [...picker.nodes, extra.node, title.node, alt.node],
      confirm: 'Subir y publicar',
      onConfirm: async () => {
        if (!picker.valid()) throw new ApiError('Elegí una fotografía válida.', 400);
        if (!extra.value()) throw new ApiError(section === 'trabajos' ? 'Elegí una especialidad.' : 'Escribí el nombre del ambiente.', 400);
        const form = new FormData();
        form.set('photo', picker.input.files![0]!);
        form.set('section', section);
        form.set(extra.name, extra.value());
        form.set('title', title.input.value);
        form.set('alt', alt.input.value);
        form.set('revision', String(state.revision));
        confirmed(await api<State>('/admin/api/photos', { method: 'POST', form }), 'Fotografía subida. Publicando…');
      },
    });
  }

  function replaceDialog(photo: Photo) {
    const picker = photoPicker(photo);
    const alt = textField('Texto alternativo de la nueva foto', 'alt', photo.alt, state.limits.alt, true);
    openDialog({
      title: `Reemplazar «${photo.title}»`,
      body: [...picker.nodes, alt.node, h('p', { class: 'admin-muted' }, 'La foto nueva ocupa el mismo lugar. La anterior queda guardada como respaldo.')],
      confirm: 'Reemplazar y publicar',
      onConfirm: async () => {
        if (!picker.valid()) throw new ApiError('Elegí una fotografía válida.', 400);
        const form = new FormData();
        form.set('photo', picker.input.files![0]!);
        form.set('alt', alt.input.value);
        form.set('revision', String(state.revision));
        confirmed(await api<State>(`/admin/api/photos/${encodeURIComponent(photo.id)}`, { method: 'POST', form }), 'Fotografía reemplazada. Publicando…');
      },
    });
  }

  function textDialog(photo: Photo) {
    const alt = textField('Texto alternativo (qué se ve en la foto)', 'alt', photo.alt, state.limits.alt, true);
    const title = photo.editableTitle ? textField('Título breve', 'title', photo.title, state.limits.title) : undefined;
    openDialog({
      title: `Editar textos de «${photo.title}»`,
      body: [h('img', { src: photo.thumb, alt: '', class: 'admin-dialog__thumb' }), ...(title ? [title.node] : []), alt.node,
        h('p', { class: 'admin-muted' }, 'El texto alternativo lo leen los lectores de pantalla y los buscadores: describí lo que se ve.')],
      confirm: 'Guardar',
      onConfirm: async () => {
        confirmed(await api<State>(`/admin/api/photos/${encodeURIComponent(photo.id)}`, { method: 'PATCH', json: { alt: alt.input.value, ...(title && { title: title.input.value }), revision: state.revision } }), 'Textos guardados. Publicando…');
      },
    });
  }

  function retireDialog(photo: Photo) {
    openDialog({
      title: '¿Retirar esta fotografía?',
      body: [h('img', { src: photo.thumb, alt: '', class: 'admin-dialog__thumb' }), h('p', {}, `«${photo.title}» dejará de verse en la página. Podés restaurarla después desde «Fotografías retiradas».`)],
      confirm: 'Retirar',
      danger: true,
      onConfirm: async () => {
        confirmed(await api<State>(`/admin/api/photos/${encodeURIComponent(photo.id)}`, { method: 'DELETE', json: { revision: state.revision } }), 'Fotografía retirada. Publicando…');
      },
    });
  }

  async function restore(photo: Photo, button: HTMLButtonElement) {
    button.disabled = true;
    try { confirmed(await api<State>(`/admin/api/photos/${encodeURIComponent(photo.id)}`, { method: 'PATCH', json: { restore: true, revision: state.revision } }), 'Fotografía restaurada. Publicando…'); }
    catch (error) { handleFailure(error); button.disabled = false; }
  }

  // ——— Rendering ———

  function card(photo: Photo, options: { move?: (step: -1 | 1) => void; first?: boolean; last?: boolean; canRetire?: boolean } = {}) {
    const badge = photo.origin === 'subida' ? 'Subida' : photo.replaced ? 'Reemplazada' : 'Original';
    const actions = h('div', { class: 'photo-card__actions' });
    if (photo.removed) {
      const button = h('button', { type: 'button', class: 'admin-button' }, 'Restaurar');
      button.addEventListener('click', () => void restore(photo, button));
      actions.append(button);
    } else {
      const replace = h('button', { type: 'button', class: 'admin-button' }, 'Reemplazar');
      replace.addEventListener('click', () => replaceDialog(photo));
      const texts = h('button', { type: 'button', class: 'admin-button' }, 'Editar texto');
      texts.addEventListener('click', () => textDialog(photo));
      actions.append(replace, texts);
      if (options.move) {
        const up = h('button', { type: 'button', class: 'admin-icon', 'aria-label': `Mover «${photo.title}» antes`, disabled: options.first }, '↑');
        const down = h('button', { type: 'button', class: 'admin-icon', 'aria-label': `Mover «${photo.title}» después`, disabled: options.last }, '↓');
        up.addEventListener('click', () => options.move!(-1));
        down.addEventListener('click', () => options.move!(1));
        actions.append(up, down);
      }
      if (options.canRetire) {
        const retire = h('button', { type: 'button', class: 'admin-button admin-button--quiet' }, 'Retirar');
        retire.addEventListener('click', () => retireDialog(photo));
        actions.append(retire);
      }
    }
    return h('article', { class: `photo-card${photo.removed ? ' photo-card--removed' : ''}`, 'data-photo-id': photo.id },
      h('div', { class: 'photo-card__media' }, h('img', { src: photo.thumb, alt: photo.alt, loading: 'lazy', decoding: 'async' })),
      h('div', { class: 'photo-card__body' },
        h('p', { class: 'photo-card__meta' },
          photo.category ? h('span', { class: 'admin-chip' }, categoryLabel(photo.category)) : null,
          photo.area ? h('span', { class: 'admin-chip' }, photo.area) : null,
          h('span', { class: `admin-badge admin-badge--${badge.toLowerCase()}` }, badge)),
        h('h3', {}, photo.title),
        h('p', { class: 'photo-card__alt' }, h('span', { class: 'admin-sr' }, 'Texto alternativo: '), photo.alt)),
      actions);
  }

  function sectionHead(title: string, description: string, ...extra: Node[]) {
    return h('header', { class: 'admin-section__head' }, h('div', {}, h('h1', {}, title), h('p', { class: 'admin-muted' }, description)), ...extra);
  }

  function retiredBlock(section: Section) {
    const photos = retired(section);
    if (!photos.length) return null;
    return h('details', { class: 'admin-retired' }, h('summary', {}, `Fotografías retiradas (${photos.length})`), h('div', { class: 'photo-grid' }, ...photos.map((photo) => card(photo))));
  }

  function orderBar(section: 'trabajos' | 'espacio') {
    if (!orderDraft[section]) return null;
    const save = h('button', { type: 'button', class: 'admin-button admin-button--gold' }, 'Guardar orden');
    const discard = h('button', { type: 'button', class: 'admin-button' }, 'Descartar');
    save.addEventListener('click', async () => {
      save.disabled = true;
      save.textContent = 'Guardando…';
      try { confirmed(await api<State>('/admin/api/order', { method: 'PUT', json: { section, ids: orderDraft[section], revision: state.revision } }), 'Orden guardado. Publicando…'); }
      catch (error) { handleFailure(error); save.disabled = false; save.textContent = 'Guardar orden'; }
    });
    discard.addEventListener('click', () => { delete orderDraft[section]; render(); });
    return h('div', { class: 'admin-orderbar', role: 'region', 'aria-label': 'Orden sin guardar' }, h('p', {}, 'Cambiaste el orden.'), discard, save);
  }

  function orderedSection(section: 'trabajos' | 'espacio', visible: (photo: Photo) => boolean) {
    const ids = orderDraft[section] ?? active(section).map((photo) => photo.id);
    const byId = new Map(active(section).map((photo) => [photo.id, photo]));
    const shown = ids.map((id) => byId.get(id)!).filter((photo) => photo && visible(photo));
    const total = active(section).length;
    const minimum = section === 'trabajos' ? state.limits.works.min : state.limits.spaceStops.min;
    return h('div', { class: 'photo-grid' }, ...shown.map((photo, index) => card(photo, {
      first: index === 0,
      last: index === shown.length - 1,
      canRetire: total > minimum,
      move: (step) => {
        // Swap with the neighbour that is visible (filters keep the rest in place).
        const neighbour = shown[index + step];
        if (!neighbour) return;
        const next = [...ids];
        const a = next.indexOf(photo.id);
        const b = next.indexOf(neighbour.id);
        [next[a], next[b]] = [next[b]!, next[a]!];
        orderDraft[section] = next;
        render();
        panel.querySelector<HTMLElement>(`[data-photo-id="${CSS.escape(photo.id)}"] .admin-icon:not(:disabled)`)?.focus();
      },
    })));
  }

  const views: Record<Tab, () => Node[]> = {
    portada: () => [
      sectionHead('Portada', 'La fotografía principal, junto a «Bienvenidos a LUXE». Se puede reemplazar, no retirar.'),
      h('div', { class: 'photo-grid photo-grid--single' }, ...active('portada').map((photo) => card(photo))),
    ],
    fachada: () => [
      sectionHead('Fachada', 'La foto de la sección «Te esperamos en Concepción». Se puede reemplazar, no retirar.'),
      h('div', { class: 'photo-grid photo-grid--single' }, ...active('fachada').map((photo) => card(photo))),
    ],
    trabajos: () => {
      const upload = h('button', { type: 'button', class: 'admin-button admin-button--gold', disabled: active('trabajos').length >= state.limits.works.max }, '+ Subir trabajo');
      upload.addEventListener('click', () => uploadDialog('trabajos'));
      const chips = h('div', { class: 'admin-filters', role: 'group', 'aria-label': 'Filtrar por especialidad' },
        ...[{ id: 'all', label: 'Todos' }, ...state.categories].map((category) => {
          const count = category.id === 'all' ? active('trabajos').length : active('trabajos').filter((photo) => photo.category === category.id).length;
          const chip = h('button', { type: 'button', class: 'admin-filter', 'aria-pressed': String(filter === category.id) }, `${category.label} (${count})`);
          chip.addEventListener('click', () => { filter = category.id; render(); });
          return chip;
        }));
      return [
        sectionHead('Trabajos', 'Galería «Nuestros trabajos». El orden es el de la galería; con las flechas lo cambiás y después guardás.', upload),
        chips,
        orderBar('trabajos'),
        orderedSection('trabajos', (photo) => filter === 'all' || photo.category === filter),
        retiredBlock('trabajos'),
      ].filter(Boolean) as Node[];
    },
    espacio: () => {
      const upload = h('button', { type: 'button', class: 'admin-button admin-button--gold', disabled: active('espacio').length >= state.limits.spaceStops.max }, '+ Agregar ambiente');
      upload.addEventListener('click', () => uploadDialog('espacio'));
      return [
        sectionHead('Espacio', `Recorrido 3D «Nuestro espacio» (también aparece en el Mundo LUXE). Entre ${state.limits.spaceStops.min} y ${state.limits.spaceStops.max} ambientes.`, upload),
        orderBar('espacio'),
        orderedSection('espacio', () => true),
        retiredBlock('espacio'),
      ].filter(Boolean) as Node[];
    },
    globe: () => [
      sectionHead('Mundo LUXE', `El globo interactivo: hasta ${state.limits.globePerSpecialty} trabajos por especialidad. La primera foto es la que se destaca al elegir la especialidad.`),
      h('div', { class: 'globe-list' }, ...state.globe.map(globeCard)),
    ],
  };

  function globeCard(selection: GlobeSelection) {
    const draft = globeDraft[selection.id] ?? selection.ids;
    const works = active('trabajos').filter((photo) => photo.category === selection.category);
    const byId = new Map(works.map((photo) => [photo.id, photo]));
    const change = (next: string[]) => { globeDraft[selection.id] = next; render(); };
    const items = draft.map((id, index) => {
      const photo = byId.get(id);
      if (!photo) return null;
      const up = h('button', { type: 'button', class: 'admin-icon', 'aria-label': `Mover «${photo.title}» antes`, disabled: index === 0 }, '↑');
      const down = h('button', { type: 'button', class: 'admin-icon', 'aria-label': `Mover «${photo.title}» después`, disabled: index === draft.length - 1 }, '↓');
      const remove = h('button', { type: 'button', class: 'admin-icon', 'aria-label': `Quitar «${photo.title}» del Mundo LUXE` }, '✕');
      const swap = (step: -1 | 1) => { const next = [...draft]; [next[index], next[index + step]] = [next[index + step]!, next[index]!]; change(next); };
      up.addEventListener('click', () => swap(-1));
      down.addEventListener('click', () => swap(1));
      remove.addEventListener('click', () => change(draft.filter((other) => other !== id)));
      return h('li', { class: 'globe-item' }, h('img', { src: photo.thumb, alt: '' }), h('span', {}, index === 0 ? h('strong', {}, 'Destacada · ') : null, photo.title), h('span', { class: 'globe-item__actions' }, up, down, remove));
    });
    const available = works.filter((photo) => !draft.includes(photo.id));
    const add = h('select', { 'aria-label': `Agregar un trabajo a ${selection.name}`, disabled: draft.length >= state.limits.globePerSpecialty || !available.length },
      h('option', { value: '' }, draft.length >= state.limits.globePerSpecialty ? 'Máximo alcanzado' : available.length ? '+ Agregar trabajo…' : 'No hay más trabajos de esta especialidad'),
      ...available.map((photo) => h('option', { value: photo.id }, photo.title)));
    add.addEventListener('change', () => { if (add.value) change([...draft, add.value]); });
    const dirty = Boolean(globeDraft[selection.id]);
    const save = h('button', { type: 'button', class: 'admin-button admin-button--gold', disabled: !dirty }, 'Guardar');
    save.addEventListener('click', async () => {
      save.disabled = true;
      save.textContent = 'Guardando…';
      try { confirmed(await api<State>('/admin/api/order', { method: 'PUT', json: { section: 'globe', specialty: selection.id, ids: draft, revision: state.revision } }), `${selection.name}: selección guardada. Publicando…`); }
      catch (error) { handleFailure(error); save.disabled = false; save.textContent = 'Guardar'; }
    });
    return h('section', { class: 'globe-card', 'aria-label': selection.name },
      h('header', {}, h('h2', {}, selection.name), selection.automatic && !dirty ? h('span', { class: 'admin-chip' }, 'Automático') : null),
      draft.length ? h('ol', { class: 'globe-items' }, ...items) : h('p', { class: 'admin-muted' }, 'Sin selección: el globo muestra el emblema de LUXE o los primeros trabajos de la especialidad.'),
      h('div', { class: 'globe-card__foot' }, add, save));
  }

  function render() {
    for (const button of tabs) button.setAttribute('aria-current', String(button.dataset.tab === tab));
    renderPublish();
    panel.replaceChildren(...views[tab]());
  }

  for (const button of tabs) {
    button.addEventListener('click', () => {
      tab = button.dataset.tab as Tab;
      history.replaceState(null, '', `#${tab}`);
      render();
      panel.focus({ preventScroll: true });
    });
  }

  document.querySelector('[data-logout]')?.addEventListener('click', async () => {
    try { await api('/admin/api/session', { method: 'DELETE', json: {} }); } catch { /* the reload shows the real state */ }
    location.replace('/admin');
  });

  window.addEventListener('beforeunload', (event) => {
    if (Object.keys(orderDraft).length || Object.keys(globeDraft).length) event.preventDefault();
  });

  render();
  watchPublish();
}
