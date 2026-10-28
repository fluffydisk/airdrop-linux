/* Shared desktop/PWA file manager. Adapters own privileged I/O. */
'use strict';
(function (global) {
  const symbols = { directory: '📁', image: '🖼️', video: '🎬', audio: '🎵', pdf: '📕', archive: '🗜️', text: '📄', file: '📎' };
  function kind(file) {
    if (file.type === 'directory') return 'directory';
    const ext = file.name.split('.').pop().toLowerCase();
    if (/^(png|jpg|jpeg|gif|webp|svg|heic|avif|bmp)$/.test(ext)) return 'image';
    if (/^(mp4|mov|mkv|webm|avi)$/.test(ext)) return 'video';
    if (/^(mp3|wav|flac|ogg|m4a|aac)$/.test(ext)) return 'audio';
    if (ext === 'pdf') return 'pdf';
    if (/^(zip|gz|tar|7z|rar|xz)$/.test(ext)) return 'archive';
    return /^(txt|md|json|csv|log|js|html|css|xml)$/.test(ext) ? 'text' : 'file';
  }
  function node(tag, text, className) { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; }
  function mount(host, adapter, options = {}) {
    host.replaceChildren();
    host.classList.add('explorer'); host.tabIndex = 0; host.setAttribute('aria-label', 'Shared files');
    let directory = '', entries = [], selected = new Set(), history = [''], position = 0, anchor = 0, busy = false, trash = false, request = 0;
    let mode = 'grid'; try { mode = localStorage.getItem('airdrop-file-view') || 'grid'; } catch {}
    const sorts = { 'name-asc': 'Name · A–Z', 'name-desc': 'Name · Z–A', 'date-desc': 'Date · Newest first', 'date-asc': 'Date · Oldest first', 'size-desc': 'Size · Largest first', 'size-asc': 'Size · Smallest first', 'type-asc': 'File type' };
    let order = 'name-asc'; try { const saved = localStorage.getItem('airdrop-file-sort'); if (Object.hasOwn(sorts, saved)) order = saved; } catch {}
    const nav = node('div', undefined, 'explorer-toolbar'), crumbs = node('nav', undefined, 'explorer-crumbs'); crumbs.setAttribute('aria-label', 'Folder path');
    const actions = node('div', undefined, 'explorer-toolbar');
    const content = node('div', undefined, 'explorer-items'); content.setAttribute('role', 'group');
    const status = node('p', '', 'explorer-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const menu = node('div', undefined, 'explorer-menu'); menu.hidden = true; menu.setAttribute('role', 'menu');
    const dialog = node('dialog', undefined, 'explorer-dialog'); const form = node('form'); form.method = 'dialog';
    const label = node('label', 'Folder name'); const input = node('input'); input.required = true; input.maxLength = 200; input.setAttribute('aria-label', 'Folder name');
    const submit = node('button', 'Create'); submit.type = 'submit'; const cancel = node('button', 'Cancel'); cancel.type = 'button'; cancel.onclick = () => dialog.close();
    label.append(input); form.append(label, submit, cancel); dialog.append(form);
    host.append(nav, crumbs, actions, content, status, menu, dialog);
    function say(text) { status.textContent = text; options.onMessage?.(text); }
    function button(parent, text, action, title = text) {
      const control = node('button', text); control.type = 'button'; control.title = title; control.setAttribute('aria-label', title);
      control.onclick = () => Promise.resolve().then(action).catch(error => say(error.message)); parent.append(control); return control;
    }
    if (options.choose) button(nav, 'Upload', options.choose);
    const back = button(nav, '←', () => goHistory(-1), 'Back');
    const forward = button(nav, '→', () => goHistory(1), 'Forward');
    const up = button(nav, '↑', () => navigate(directory.split('/').slice(0, -1).join('/')), 'Parent folder');
    button(nav, '⌂', () => navigate(''), 'Airdrop root');
    button(nav, '↻', refresh, 'Refresh files');
    button(nav, 'Grid / List', () => { mode = mode === 'grid' ? 'list' : 'grid'; try { localStorage.setItem('airdrop-file-view', mode); } catch {} render(); });
    button(nav, 'Trash', async () => { trash = !trash; selected.clear(); await refresh(); });
    const sort = node('select'); sort.setAttribute('aria-label', 'Sort files');
    for (const [value, label] of Object.entries(sorts)) { const option = node('option', label); option.value = value; sort.append(option); }
    sort.value = order;
    sort.onchange = () => { order = sort.value; anchor = 0; try { localStorage.setItem('airdrop-file-sort', order); } catch {} render(); };
    nav.append(sort);
    global.addEventListener('airdrop-preferences', () => { try { const saved = localStorage.getItem('airdrop-file-sort'); if (Object.hasOwn(sorts, saved)) { order = saved; sort.value = order; render(); } } catch {} });
    if (adapter.reveal) button(nav, 'Open folder location', () => adapter.reveal(directory));
    const newFolder = button(actions, 'New folder', async () => { const name = await askName(); if (name) await run(() => adapter.mkdir(directory, name), 'Folder created'); });
    const copy = button(actions, 'Copy to folder', copySelection);
    const download = button(actions, 'Download', downloadSelection);
    const remove = button(actions, 'Delete', trashSelection);
    const restore = button(actions, 'Restore', restoreSelection);
    const selectAll = button(actions, 'Select all', () => { selected = new Set(entries.map(file => trash ? file.id : file.path)); updateSelection(); });
    const permanentlyDelete = button(actions, 'Delete permanently', deleteSelection);
    const count = node('span', '', 'explorer-selection'); actions.append(count);
    function askName() {
      return new Promise(resolve => {
        input.value = ''; dialog.addEventListener('close', () => resolve(dialog.returnValue === 'create' ? input.value.trim() : null), { once: true });
        dialog.returnValue = ''; form.onsubmit = event => { event.preventDefault(); if (input.value.trim()) dialog.close('create'); };
        dialog.showModal(); input.focus();
      });
    }
    function controls() {
      back.disabled = busy || position <= 0; forward.disabled = busy || position >= history.length - 1;
      up.disabled = busy || trash || !directory; newFolder.disabled = busy || trash;
      for (const item of [copy, download, remove]) { item.hidden = trash; item.disabled = busy || !selected.size; }
      selectAll.disabled = busy || !entries.length;
      permanentlyDelete.hidden = !trash || !adapter.deleteTrash; permanentlyDelete.disabled = busy || !selected.size;
      restore.hidden = !trash; restore.disabled = busy || !selected.size;
      count.textContent = selected.size ? `${selected.size} selected` : `${entries.length} items`;
    }
    function updateSelection() {
      // Keep the clicked nodes alive so the browser can recognize a double click.
      for (const row of content.querySelectorAll('.explorer-item')) {
        const checked = selected.has(row.dataset.key);
        row.classList.toggle('selected', checked);
        row.querySelector('input').checked = checked;
      }
      controls();
    }
    function render() {
      entries.sort((a, b) => {
        const folders = Number(b.type === 'directory') - Number(a.type === 'directory');
        if (folders) return folders;
        const [field, direction] = order.split('-');
        const value = field === 'date' ? (a.deleted || a.modified || 0) - (b.deleted || b.modified || 0) : field === 'size' ? (a.size || 0) - (b.size || 0) : field === 'type' ? kind(a).localeCompare(kind(b)) : a.name.localeCompare(b.name, undefined, {numeric:true,sensitivity:'base'});
        return value * (direction === 'desc' ? -1 : 1) || a.name.localeCompare(b.name);
      });
      content.className = 'explorer-items explorer-' + mode; content.replaceChildren(); crumbs.replaceChildren();
      dropTarget(button(crumbs, 'Airdrop', () => navigate('')), () => '');
      if (trash) crumbs.append(node('span', ' / Trash'));
      else { const segments = directory.split('/').filter(Boolean); segments.forEach((part, index) => { crumbs.append(node('span', '/')); dropTarget(button(crumbs, part, () => navigate(segments.slice(0, index + 1).join('/'))), () => segments.slice(0, index + 1).join('/')); }); }
      entries.forEach((file, index) => {
        const key = trash ? file.id : file.path;
        const row = node('div', undefined, 'explorer-item'); row.dataset.path = file.path; row.dataset.key = key; row.dataset.kind = kind(file); row.classList.toggle('selected', selected.has(key)); row.tabIndex = 0;
        if ((adapter.drag || adapter.move) && !trash && file.type === 'file') {
          row.draggable = true;
          row.title = 'Drag to a folder to move. Hold Alt while dragging to copy to another application.';
          row.ondragstart = event => {
            if (busy) { event.preventDefault(); return; }
            const paths = selected.has(key) ? entries.filter(entry => selected.has(entry.path) && entry.type === 'file').map(entry => entry.path) : [file.path];
            if (adapter.move && !event.altKey) {
              event.dataTransfer.setData('application/x-airdrop-paths', JSON.stringify(paths)); event.dataTransfer.effectAllowed = 'move'; return;
            }
            event.preventDefault();
            try { adapter.drag(paths); say('Drag to another application to copy. The original stays in Airdrop.'); } catch (error) { say(error.message); }
          };
        }
        const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(key); checkbox.setAttribute('aria-label', `Select ${file.name}`);
        checkbox.onclick = event => event.stopPropagation(); checkbox.onchange = () => { if (checkbox.checked) selected.add(key); else selected.delete(key); anchor = index; updateSelection(); };
        const symbol = node('span', symbols[kind(file)], 'explorer-symbol'); symbol.setAttribute('aria-hidden', 'true');
        const details = node('div', undefined, 'explorer-details'); const name = node('span', file.name, 'explorer-name'); name.title = file.name;
        const meta = node('small', trash ? file.path : file.type === 'directory' ? 'Folder' : file.size < 1024 ? `${file.size || 0} B` : file.size < 1024 ** 2 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / 1024 ** 2).toFixed(1)} MB`);
        if (!trash && file.modified) { const date = new Date(file.modified); meta.append(document.createTextNode(' · ' + date.toLocaleDateString())); meta.title = date.toLocaleString(); }
        details.append(name, meta); row.append(checkbox, symbol, details);
        row.onclick = event => {
          if (event.detail > 1) return;
          if (event.shiftKey) { if (!event.ctrlKey && !event.metaKey) selected.clear(); for (let i = Math.min(anchor, index); i <= Math.max(anchor, index); i++) selected.add(trash ? entries[i].id : entries[i].path); }
          else if (event.ctrlKey || event.metaKey) { if (selected.has(key)) selected.delete(key); else selected.add(key); anchor = index; }
          else { selected = new Set([key]); anchor = index; }
          updateSelection();
        };
        const open = async () => {
          if (trash || busy) return;
          if (file.type === 'directory') return navigate(file.path);
          busy = true; controls();
          try {
            if (adapter.open) { await adapter.open(file.path); say(`Opened: ${file.name}`); }
            else { await adapter.download([file.path]); say('Download requested'); }
          } catch (error) { say(error.message); }
          finally { busy = false; controls(); }
        };
        row.ondblclick = event => { if (!event.target.closest('input, button')) open(); };
        row.onkeydown = event => { if (event.target !== row) return; if (event.key === 'Enter') { event.preventDefault(); open(); } if (event.key === ' ') { event.preventDefault(); checkbox.click(); } };
        if (file.type === 'directory' && !trash) { const openButton = button(row, 'Open', open, `Open ${file.name}`); openButton.onclick = event => { event.stopPropagation(); open(); }; }
        if (file.type === 'directory' && !trash) dropTarget(row, () => file.path);
        row.oncontextmenu = event => {
          event.preventDefault(); if (!selected.has(key)) { selected = new Set([key]); updateSelection(); }
          menu.replaceChildren();
          for (const [label, action] of trash ? [['Restore', restoreSelection], ['Delete permanently', deleteSelection]] : [['Delete', trashSelection], ['Download', downloadSelection], ['Copy to folder', copySelection]]) {
            const item = button(menu, label, () => { menu.hidden = true; return action(); }); item.setAttribute('role', 'menuitem'); item.disabled = busy;
          }
          menu.hidden = false; menu.style.left = Math.min(event.clientX, innerWidth - 210) + 'px'; menu.style.top = Math.min(event.clientY, innerHeight - 160) + 'px'; menu.querySelector('button')?.focus();
        };
        content.append(row);
      });
      if (!entries.length) content.append(node('p', trash ? 'Trash is empty.' : 'No files yet. Drop files or paste with Ctrl+V.', 'explorer-empty'));
      controls();
    }
    async function refresh() {
      const version = ++request, current = directory, inTrash = trash;
      try {
        const result = inTrash ? await adapter.trashList() : await adapter.list(current);
        if (version !== request) return;
        entries = result; selected = new Set([...selected].filter(key => entries.some(file => (inTrash ? file.id : file.path) === key))); render();
      } catch (error) { if (version === request) say(error.message); }
    }
    async function navigate(target, addHistory = true) {
      if (busy) return;
      trash = false; directory = target; selected.clear();
      if (addHistory && history[position] !== target) { history = history.slice(0, position + 1); history.push(target); position++; }
      entries = []; render();
      await refresh(); options.onNavigate?.(directory);
    }
    async function goHistory(delta) { if (busy || !history[position + delta] && history[position + delta] !== '') return; position += delta; await navigate(history[position], false); }
    async function run(action, success) {
      if (busy) return;
      busy = true; controls(); say('Working…');
      try { const result = await action(); say(success || 'Done'); await refresh(); return result; }
      catch (error) { await refresh(); say(error.message); throw error; }
      finally { busy = false; controls(); }
    }
    async function copySelection() {
      const paths = [...selected], target = directory; if (!paths.length) return;
      const name = await askName(); if (name) await run(() => adapter.copy(target, paths, name), 'Copied. Originals kept.');
    }
    async function downloadSelection() { const paths = [...selected]; if (paths.length) await run(() => adapter.download(paths), 'Download requested'); }
    async function trashSelection() {
      const paths = [...selected]; if (!paths.length) return;
      const results = await run(() => adapter.trash(paths), 'Moved to trash');
      if (!results) return;
      const good = results.filter(item => item.ok), failed = results.filter(item => !item.ok);
      say(failed.length ? failed.map(item => `${item.path}: ${item.error}`).join('; ') : 'Moved to trash. ');
      if (good.length) button(status, 'Undo', () => run(async () => { for (const item of good) await adapter.restore(item.id); }, 'Restored'));
      selected.clear(); controls();
    }
    async function deleteSelection() {
      const ids = [...selected]; if (!ids.length || !adapter.deleteTrash) return;
      if (!global.confirm(`Permanently delete ${ids.length} item(s)? This cannot be undone.`)) return;
      await run(() => adapter.deleteTrash(ids), 'Permanently deleted');
    }
    function dropTarget(element, target) {
      element.addEventListener('dragover', event => {
        if (!trash && adapter.move && event.dataTransfer?.types?.includes('application/x-airdrop-paths')) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; }
      });
      element.addEventListener('drop', event => {
        if (!event.dataTransfer?.types?.includes('application/x-airdrop-paths')) return;
        event.preventDefault(); event.stopPropagation(); if (busy || trash) return;
        try { const paths = JSON.parse(event.dataTransfer.getData('application/x-airdrop-paths'));
          run(() => adapter.move(target(), paths), 'Move complete').catch(() => {});
        } catch (error) { say(error.message); }
      });
    }
    dropTarget(content, () => directory);
    async function restoreSelection() { const ids = [...selected]; if (ids.length) await run(async () => { for (const id of ids) await adapter.restore(id); }, 'Restored'); }
    document.addEventListener('click', event => { if (!menu.contains(event.target)) menu.hidden = true; });
    const enabled = () => options.enabled ? options.enabled() : !host.hidden;
    const editable = target => target.closest?.('textarea, [contenteditable="true"], [role="textbox"], input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=file])');
    document.addEventListener('keydown', event => {
      if (!enabled() || editable(event.target)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && host.contains(event.target)) { event.preventDefault(); selected = new Set(entries.map(file => trash ? file.id : file.path)); updateSelection(); }
      if (adapter.paste && !adapter.pasteFiles && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        if (busy || trash) { say('Open a folder and wait for the current operation to finish before pasting.'); return; }
        const target = directory;
        run(() => adapter.paste(target), 'Pasted into shared folder').catch(() => {});
      }
      if (event.key === 'Escape') menu.hidden = true;
    });
    document.addEventListener('paste', event => {
      if (!enabled() || editable(event.target)) return;
      event.preventDefault(); if (trash || busy) { say('Open a folder and wait for the current operation to finish before pasting.'); return; }
      const target = directory;
      run(async () => {
        const files = Array.from(event.clipboardData?.files || []);
        if (files.length && adapter.pasteFiles) return adapter.pasteFiles(target, files);
        if (adapter.paste) return adapter.paste(target);
        const image = Array.from(event.clipboardData?.items || []).find(item => item.type.startsWith('image/'));
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        if (image) {
          const file = image.getAsFile(); if (!file) throw new Error('Clipboard image unavailable');
          const bitmap = await createImageBitmap(file);
          try {
            const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height; canvas.getContext('2d').drawImage(bitmap, 0, 0);
            const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); if (!png) throw new Error('Could not convert clipboard image');
            return adapter.upload(target, new File([png], `clipboard-${stamp}.png`, { type: 'image/png' }));
          } finally { bitmap.close(); }
        }
        const text = event.clipboardData?.getData('text/plain');
        if (!text) throw new Error('Clipboard has no supported image or text');
        if (new TextEncoder().encode(text).length > 1024 * 1024) throw new Error('Clipboard text must be at most 1 MiB.');
        return adapter.upload(target, new File([text], `clipboard-${stamp}.txt`, { type: 'text/plain' }));
      }, 'Pasted into shared folder').catch(() => {});
    });
    render(); refresh();
    return { refresh, navigate, get directory() { return directory; }, get busy() { return busy; }, say };
  }
  global.AirdropExplorer = { mount, kind };
})(window);
