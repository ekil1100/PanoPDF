import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  anchorPage, clampScale, fitScale, heightScale, isPageWheel, normalizePosition, pageStep,
  pdfErrorMessage, positiveInteger, safeExternalUrl, wheelPixels,
} from '../src/reader-layout.ts';
import type { ReadingPosition } from '../src/contracts.ts';

const portrait = { width: 600, height: 800 };

test('scale bounds reject non-finite input and support detail-canvas zoom', () => {
  assert.equal(clampScale(NaN), 1);
  assert.equal(clampScale(Infinity), 1);
  assert.equal(clampScale(-1), 0.1);
  assert.equal(clampScale(50), 25);
  assert.equal(clampScale(1.75), 1.75);
  assert.equal(positiveInteger(3.9), 3);
  assert.equal(positiveInteger(Infinity, 2), 2);
});

test('position normalization preserves PDF coordinates and validates persisted settings', () => {
  const position = normalizePosition({
    page: -1, scale: NaN, layout: 'bad', columns: 0, zoomMode: 'bad', fitPages: 2.8,
    scrollInput: 'bad', left: -17.5, top: 730.2,
  } as unknown as ReadingPosition);
  assert.deepEqual(position, {
    page: 1, scale: 1, layout: 'horizontal', columns: 1, zoomMode: 'height', fitPages: 2,
    scrollInput: 'auto', left: -17.5, top: 730.2,
  });
  assert.equal(normalizePosition({ ...position, left: NaN }).left, undefined);
  assert.equal(normalizePosition({ ...position, top: Infinity }).top, undefined);
  assert.equal(normalizePosition({ ...position, zoomMode: 'pages', scrollInput: 'smooth' }).zoomMode, 'pages');
});

test('anchors prefer the current page over a preceding-row sliver, unless pointing at another page', () => {
  assert.equal(anchorPage([10, 11, 8], 10), 10);
  assert.equal(anchorPage([8, 10], 10), 10);
  assert.equal(anchorPage([10, 8], 10, 8), 8);
  assert.equal(anchorPage([10, 11], 8), 10);
  assert.equal(anchorPage([], 10), 10);
});

test('horizontal fit uses the actual widths, gaps and tallest page', () => {
  assert.equal(fitScale({ width: 1248, height: 832 }, [portrait, portrait], 'horizontal', 99), 1);
  assert.equal(fitScale({ width: 1248, height: 432 }, [portrait, portrait], 'horizontal', 1), 0.5);
  assert.equal(fitScale({ width: 1848, height: 832 }, [portrait, { width: 1200, height: 500 }], 'horizontal', 2), 1);
});

test('vertical fit accounts for configured columns and rows without changing scale policy', () => {
  assert.equal(fitScale({ width: 1248, height: 1648 }, Array(4).fill(portrait), 'vertical', 2), 1);
  assert.equal(fitScale({ width: 632, height: 2464 }, Array(3).fill(portrait), 'vertical', 1), 1);
  assert.equal(fitScale({ width: 1248, height: 1648 }, Array(3).fill(portrait), 'vertical', 2), 1);
});

test('fit choices respond to resize and support more than four simultaneous pages', () => {
  const pages = Array(7).fill(portrait);
  const small = fitScale({ width: 1800, height: 1000 }, pages, 'horizontal', 1);
  const large = fitScale({ width: 3600, height: 1000 }, pages, 'horizontal', 1);
  assert.ok(large > small);
  assert.equal(heightScale(832, 800), 1);
  assert.equal(heightScale(432, 800), 0.5);
  assert.equal(heightScale(431, 800), 0.49);
  assert.equal(fitScale({ width: 0, height: 0 }, [], 'horizontal', 1), 1);
});

test('auto input distinguishes common detents conservatively; explicit overrides win', () => {
  const sample = { deltaX: 0, deltaY: 100, deltaMode: 0 };
  assert.equal(isPageWheel('auto', sample), true);
  assert.equal(isPageWheel('auto', sample, true), false);
  assert.equal(isPageWheel('auto', { ...sample, deltaY: 3.25 }), false);
  assert.equal(isPageWheel('auto', { ...sample, deltaY: 3, deltaMode: 1 }), true);
  assert.equal(isPageWheel('smooth', sample), false);
  assert.equal(isPageWheel('page', { ...sample, deltaY: 0.25 }), true);
  assert.equal(isPageWheel('page', { ...sample, deltaX: 5 }), false);
  assert.equal(isPageWheel('auto', { ...sample, deltaY: 73 }), false);
});

test('wheel normalization respects pixel, line and page units', () => {
  assert.deepEqual(wheelPixels({ deltaX: 2, deltaY: -3, deltaMode: 0 }, 800), [2, -3]);
  assert.deepEqual(wheelPixels({ deltaX: 2, deltaY: -3, deltaMode: 1 }, 800), [32, -48]);
  assert.deepEqual(wheelPixels({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 800), [0, 800]);
});

test('page stepping aligns adjacent pages in a continuous strip', () => {
  const pages = [{ start: 16, size: 600 }, { start: 632, size: 600 }, { start: 1248, size: 600 }];
  assert.equal(pageStep(pages, 0, 632, 1), 616);
  assert.equal(pageStep(pages, 616, 632, 1), 1232);
  assert.equal(pageStep(pages, 1232, 632, -1), 616);
  assert.equal(pageStep(pages, 0, 632, -1), 0);
  assert.equal(pageStep([], 10, 632, 1), 10);
});

test('oversized pages pan to their far edge before advancing, and can pan back', () => {
  const pages = [{ start: 16, size: 2000 }, { start: 2032, size: 600 }];
  assert.equal(pageStep(pages, 0, 800, 1), 680);
  assert.equal(pageStep(pages, 680, 800, 1), 1232);
  assert.equal(pageStep(pages, 1232, 800, 1), 2016);
  assert.equal(pageStep(pages, 2016, 800, -1), 1232);
  assert.equal(pageStep(pages, 1232, 800, -1), 552);
});

test('external links allow only web and mail protocols', () => {
  assert.equal(safeExternalUrl('https://example.com'), 'https://example.com/');
  assert.equal(safeExternalUrl('mailto:reader@example.com'), 'mailto:reader@example.com');
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'blob:https://example.com/id', 'ftp://example.com', '../secret', '//example.com']) {
    assert.equal(safeExternalUrl(url), null);
  }
});

test('errors are actionable Chinese text and never leak raw parser errors', () => {
  const error = new Error('Internal stack or sensitive path');
  error.name = 'InvalidPDFException';
  assert.match(pdfErrorMessage(error), /损坏/);
  error.name = 'PasswordException';
  assert.match(pdfErrorMessage(error), /密码/);
  error.name = 'WorkerError';
  assert.match(pdfErrorMessage(error), /渲染进程/);
  assert.doesNotMatch(pdfErrorMessage(new Error('private path')), /private path/);
});
