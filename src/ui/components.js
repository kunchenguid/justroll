import { html } from './h.js';
import { Box, Text } from 'ink';
import { C, G } from './theme.js';

// Rounded panel. `title` may be a string or a React node; `status` sits on the right.
export function Frame({ title, status, statusColor, color = C.border, children, minWidth }) {
  return html`
    <${Box}
      flexDirection="column"
      borderStyle="round"
      borderColor=${color}
      paddingX=${1}
      minWidth=${minWidth}
    >
      <${Box} justifyContent="space-between" marginBottom=${1}>
        ${typeof title === 'string' ? html`<${Text} bold=${true}>${title}</${Text}>` : title}
        ${status ? html`<${Text} color=${statusColor || C.dim}>${status}</${Text}>` : null}
      <//>
      ${children}
    <//>
  `;
}

export function Hint({ keys, label, last }) {
  return html`
    <${Text}>
      <${Text} color=${C.bright}>${keys}</${Text}>
      <${Text} color=${C.dim}> ${label}${last ? '' : '   '}</${Text}>
    </${Text}>
  `;
}

export function HintBar({ hints }) {
  return html`
    <${Box} marginTop=${1}>
      ${hints.map(
        (h, i) =>
          html`<${Hint} key=${i} keys=${h[0]} label=${h[1]} last=${i === hints.length - 1} />`,
      )}
    <//>
  `;
}

// A list row. The focused row is a full-width inverse highlight bar (no cursor arrow).
// `multi` rows keep a checkbox for their selected state; single-select rows use the
// highlight itself as the selection.
export function Row({ focused, selected, multi, label, meta, accent = C.text, width = 60 }) {
  const box = multi ? (selected ? G.check : G.ring) : null;
  // Toggle-able rows get a space before the checkbox; single-select rows stay flush left.
  const leftText = box ? ` ${box} ${label}` : `${label}`;
  const rightText = meta ? `${meta} ` : '';

  if (focused) {
    const pad = Math.max(1, width - leftText.length - rightText.length);
    return html`<${Text} inverse=${true} color=${accent} bold=${true}>${leftText + ' '.repeat(pad) + rightText}</${Text}>`;
  }
  return html`
    <${Box} width=${width}>
      ${box ? html`<${Text} color=${selected ? C.ok : C.dim}> ${box} </${Text}>` : null}
      <${Text} color=${C.text}>${label}</${Text}>
      <${Box} flexGrow=${1} />
      <${Text} color=${C.dim}>${rightText}</${Text}>
    <//>
  `;
}

// A navigable setting on the review screen: label left, ‹ value › right, highlight when focused.
export function SettingRow({ focused, label, value, width = 60 }) {
  const leftText = label;
  const rightText = `‹ ${value} › `;
  if (focused) {
    const pad = Math.max(1, width - leftText.length - rightText.length);
    return html`<${Text} inverse=${true} color=${C.ok} bold=${true}>${leftText + ' '.repeat(pad) + rightText}</${Text}>`;
  }
  return html`
    <${Box} width=${width}>
      <${Text} color=${C.text}>${leftText}</${Text}>
      <${Box} flexGrow=${1} />
      <${Text} color=${C.dim}>${rightText}</${Text}>
    <//>
  `;
}

export function StepDots({ index, total }) {
  const dots = [];
  for (let i = 0; i < total; i++) {
    dots.push(
      html`<${Text} key=${i} color=${i === index ? C.ok : i < index ? C.dim : C.border}>${
        i === index ? '◆' : '◇'
      } </${Text}>`,
    );
  }
  return html`<${Box}>${dots}<//>`;
}
