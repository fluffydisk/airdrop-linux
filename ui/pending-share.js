/* IndexedDB staging shared by the page and service worker. */
(function (root) {
  const MAX_AGE = 24 * 60 * 60 * 1000;
  function database() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('airdrop-shares', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('shares', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function transaction(mode, run) {
    const db = await database();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('shares', mode);
        let result;
        const request = run(tx.objectStore('shares'));
        if (request) request.onsuccess = () => { result = request.result; };
        tx.oncomplete = () => resolve(result);
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('Could not stage shared files'));
      });
    } finally { db.close(); }
  }
  const api = {
    async stage(files) {
      const id = crypto.randomUUID();
      await transaction('readwrite', store => store.put({ id, created: Date.now(), files: files.map(file => ({ name: file.name, type: file.type, modified: file.lastModified, file })) }));
      return id;
    },
    async get(id) {
      const entry = await transaction('readonly', store => store.get(id));
      if (!entry) return null;
      if (Date.now() - entry.created >= MAX_AGE) { await api.remove(id); return null; }
      return entry.files.map(item => new File([item.file], item.name, { type: item.type, lastModified: item.modified }));
    },
    remove: id => transaction('readwrite', store => store.delete(id)),
    cleanup: () => transaction('readwrite', store => {
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (Date.now() - cursor.value.created >= MAX_AGE) cursor.delete();
        cursor.continue();
      };
      // Cursor manages its own success callback.
      return null;
    })
  };
  root.AirdropShares = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
