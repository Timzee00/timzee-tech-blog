const paths = {
  fyp: '<path d="M12 2l2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5L12 2Z"/><path d="m19 18 .8 1.8L22 20.5l-2.2.7L19 23l-.8-1.8-2.2-.7 2.2-.7L19 18Z"/>',
  video: '<rect x="4" y="5" width="16" height="14" rx="3"/><path d="m10 9 5 3-5 3Z"/>',
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  discussion: '<path d="M21 11a8 8 0 0 1-8 8H7l-5 3 2-6a8 8 0 1 1 17-5Z"/><path d="M8 10h8M8 14h5"/>',
  marketplace: '<path d="M3 8h18l-2-5H5ZM4 8v12h16V8M9 20v-7h6v7"/>',
  videos: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m10 8 6 4-6 4Z"/>',
  novels: '<path d="M12 5v16M12 5C8 2 3 3 2 4v15c4-2 7-1 10 2 3-3 6-4 10-2V4c-1-1-6-2-10 1Z"/>',
  stories: '<rect x="3" y="6" width="18" height="15" rx="3"/><path d="m8 6 1-3h6l1 3"/><circle cx="12" cy="13" r="4"/>',
  chat: '<path d="M21 11a8 8 0 0 1-8 8H7l-5 3 2-6a8 8 0 1 1 17-5Z"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>'

  // Blipmood UI action set — 24px grid, rounded 1.8px strokes, no icon-font or emoji dependencies.
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  comment: '<path d="M20 11.5a8 8 0 0 1-8 8c-1.4 0-2.8-.3-4-.9L3 21l1.5-5A8 8 0 1 1 20 11.5Z"/>',
  share: '<path d="M12 15V3m-4 4 4-4 4 4M5 13v5a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-5"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  bookmark: '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  upload: '<path d="M12 16V3m-4 4 4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  download: '<path d="M12 3v13m-4-4 4 4 4-4M4 18v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2"/>',
  'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  music: '<path d="M9 18V5l12-2v13M9 7l12-2"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  send: '<path d="m22 2-7.5 20-4.3-8.2L2 9.5 22 2ZM10.2 13.8 22 2"/>',
  'more-horizontal': '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  'arrow-up-right': '<path d="M7 17 17 7M7 7h10v10"/>',
  'book-open': '<path d="M12 5v16M12 5C8 2 3 3 2 4v15c4-2 7-1 10 2 3-3 6-4 10-2V4c-1-1-6-2-10 1Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  'volume-2': '<path d="M11 5 6 9H3v6h3l5 4V5ZM15 9a5 5 0 0 1 0 6M18 6a9 9 0 0 1 0 12"/>',
  'volume-x': '<path d="M11 5 6 9H3v6h3l5 4V5ZM16 9l6 6m0-6-6 6"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
};
export function icon(name) {
  return `<svg class="bm-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name] || paths.discussion}</svg>`;
}
