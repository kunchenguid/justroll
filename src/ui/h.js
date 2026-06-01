// Build-free JSX: htm bound to React.createElement so the whole TUI runs under plain `node`.
import React from 'react';
import htm from 'htm';

export const html = htm.bind(React.createElement);
export { React };
