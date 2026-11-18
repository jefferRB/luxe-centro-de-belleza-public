import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_CATEGORY, createShowcaseState, formatCounter, sequenceFor, wrapIndex } from '../src/lib/showcase-state.ts';
import { buildPortfolio, categoryCta, portfolioCategories, portfolioCopy } from '../src/data/portfolio.ts';
import { canUseMedia, isWork, mediaCatalog, workCategories } from '../src/data/media-catalog.ts';

// Real catalog order and categories; images are irrelevant to navigation logic.
const fakeImage = { src: '/x.webp', width: 800, height: 1000, format: 'webp' } as const;
const local = mediaCatalog.filter((item) => canUseMedia(item, true)).map((item) => ({ ...item, image: fakeImage }));
const portfolio = buildPortfolio(local as never);

test('cada fotografía de trabajo tiene copy propio y no hay copy huérfano', () => {
  const works = mediaCatalog.filter(isWork).map((item) => item.id).sort();
  assert.deepEqual(Object.keys(portfolioCopy).sort(), works);
  assert.equal(new Set(Object.values(portfolioCopy).map((copy) => copy.title)).size, works.length);
  for (const copy of Object.values(portfolioCopy)) {
    assert.ok(copy.title.length > 8 && copy.description.length > 30);
    assert.doesNotMatch(`${copy.title} ${copy.description}`, /₡|\$|garantiz|cura|médic|100\s?%|mejor de/i);
  }
});

test('el portafolio se ordena por catálogo, sin interiores, promociones ni datos duplicados', () => {
  // Fase 4.3 and Mundo LUXE add works at the end of the catalog order; nothing existing is removed.
  assert.deepEqual(portfolio.map((item) => item.id), ['corte-textura', 'unas-flores', 'cejas-definidas', 'unas-azul', 'corte-peinado', 'facial-proceso', 'unas-rosa', 'corte-rizado', 'corte-barba', 'corte-linea', 'corte-fade-perfil', 'barba-trabajo', 'unas-borgona', 'peluqueria-rubio-ondas', 'peluqueria-liso',
    'barberia-perfil-barba', 'peluqueria-rubio-texturizado', 'unas-vino-animal-print', 'unas-grafico', 'unas-francesa-flores', 'facial-aparatologia', 'unas-dorado-puntos', 'unas-azul-animal-print']);
  for (const item of portfolio) {
    const record = mediaCatalog.find((entry) => entry.id === item.id)!;
    assert.equal(item.alt, record.alt);
    assert.equal(item.category, record.category);
    assert.equal(item.categoryLabel, workCategories[item.category]);
    assert.equal(item.ctaLabel, categoryCta[item.category]);
    assert.equal(item.authorizationStatus, 'demo');
  }
  assert.equal(portfolio.find((item) => item.id === 'facial-proceso')?.caption.includes('en proceso'), true);
  assert.equal(portfolio.find((item) => item.id === 'facial-aparatologia')?.caption.includes('en proceso'), true);
});

test('el build público con medios demo produce el mismo portafolio que la vista local', () => {
  const build = mediaCatalog.filter((item) => canUseMedia(item, false)).map((item) => ({ ...item, image: fakeImage }));
  assert.deepEqual(buildPortfolio(build as never).map((item) => item.id), portfolio.map((item) => item.id));
});

test('un build sin medios aprobados produce un portafolio vacío', () => {
  const underReview = mediaCatalog.map((item) => ({ ...item, permission: { status: 'local-preview' } as const }));
  const production = underReview.filter((item) => canUseMedia(item, false)).map((item) => ({ ...item, image: fakeImage }));
  assert.deepEqual(buildPortfolio(production as never), []);
  assert.deepEqual(portfolioCategories([]), []);
});

test('una fotografía sin copy revisado detiene el build', () => {
  const orphan = { ...local[0]!, id: 'sin-copy' };
  assert.throws(() => buildPortfolio([orphan] as never), /sin-copy/);
});

test('solo se muestran categorías con fotografías válidas, en el orden declarado', () => {
  // Peluquería now has real works, so it appears in its declared place.
  // Counters come from the data: 8 + 3 + 9 + 1 + 2 = 23 works.
  assert.deepEqual(portfolioCategories(portfolio).map(({ id, count }) => [id, count]), [['cortes', 8], ['peluqueria', 3], ['unas', 9], ['cejas', 1], ['faciales', 2]]);
  const withoutHair = portfolio.filter((item) => item.category !== 'peluqueria');
  assert.equal(portfolioCategories(withoutHair).some((category) => category.id === 'peluqueria'), false);
});

test('contador con ceros y recorrido circular', () => {
  assert.equal(formatCounter(0, 10), '01 / 10');
  assert.equal(formatCounter(2, 3), '03 / 03');
  assert.equal(formatCounter(0, 0), '00 / 00');
  assert.deepEqual([-1, 0, 3, 4, -4].map((index) => wrapIndex(index, 3)), [2, 0, 0, 1, 2]);
  assert.equal(wrapIndex(5, 0), 0);
});

test('Todos recorre todo; una categoría nunca mezcla otras', () => {
  assert.equal(sequenceFor(portfolio, ALL_CATEGORY).length, 23);
  for (const category of ['cortes', 'peluqueria', 'unas', 'cejas', 'faciales']) {
    assert.ok(sequenceFor(portfolio, category).every((item) => item.category === category));
  }
});

test('cambiar de categoría inicia en su primera imagen y recorre solo esa categoría', () => {
  const state = createShowcaseState(portfolio);
  assert.equal(state.current?.id, 'corte-textura');
  state.step(3);
  assert.equal(state.select('unas')?.id, 'unas-flores');
  assert.equal(state.index, 0);
  assert.deepEqual([state.step(1)?.id, state.step(1)?.id, state.step(1)?.id, state.step(1)?.id], ['unas-azul', 'unas-rosa', 'unas-borgona', 'unas-vino-animal-print']);
  state.step(5);
  assert.equal(state.current?.id, 'unas-flores', 'circular: after the newest work comes the first');
  assert.equal(state.step(-1)?.id, 'unas-azul-animal-print');
  assert.equal(state.count, 9);
});

test('categorías vacías o desconocidas no alteran el estado', () => {
  // A category with no works (here Peluquería removed on purpose) is ignored like an unknown one.
  const state = createShowcaseState(portfolio.filter((item) => item.category !== 'peluqueria'));
  state.select('cejas');
  assert.equal(state.select('peluqueria'), undefined);
  assert.equal(state.select('inexistente'), undefined);
  assert.equal(state.category, 'cejas');
  assert.equal(state.current?.id, 'cejas-definidas');
  assert.equal(state.step(1)?.id, 'cejas-definidas');
  assert.equal(createShowcaseState([]).step(1), undefined);
});

test('cambios rápidos de filtro terminan en un estado coherente', () => {
  const state = createShowcaseState(portfolio);
  for (const category of ['unas', 'cejas', 'faciales', 'cortes', ALL_CATEGORY, 'unas']) state.select(category);
  state.step(1); state.step(1); state.step(-1);
  assert.equal(state.category, 'unas');
  assert.equal(state.current?.id, 'unas-azul');
  assert.equal(formatCounter(state.index, state.count), '02 / 09');
});
