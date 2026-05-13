    class NotesApp {
      constructor() {
        this.editor = document.querySelector('.editor');
        this.toolbar = document.querySelector('.toolbar');
        this.menu = document.querySelector('.menu');
        this.fab = document.querySelector('.fab');
        this.toast = document.querySelector('.toast');
        this.saveTimeout = null;
        this.init();
      }

      async init() {
        this.notes = [];
        this.currentNoteId = null;
        this.migrateStorage();
        this.setupEditor();
        this.setupToolbar();
        this.setupEvents();
        await this.load();
        this.registerServiceWorker();
        document.execCommand('styleWithCSS', false, false);
        console.log('Notes loaded');
      }

      migrateStorage() {
        try {
          const libraryData = localStorage.getItem('notes-library');
          if (libraryData) {
            this.notes = JSON.parse(libraryData);
          } else {
            const oldHash = localStorage.getItem('notes-content');
            if (oldHash) {
              this.notes.push({ id: 'note-' + Date.now(), title: 'Migrated Note', hash: oldHash, updatedAt: Date.now() });
              localStorage.removeItem('notes-content');
              localStorage.setItem('notes-library', JSON.stringify(this.notes));
            }
          }
        } catch(e) { console.error('Migration failed', e); }
      }

      setupEditor() {
        this.editor.contentEditable = 'true';
        this.editor.spellcheck = true;

        this.editor.addEventListener('paste', (e) => {
          e.preventDefault();
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
        });

        this.editor.addEventListener('keydown', (e) => {
          if (e.ctrlKey || e.metaKey) {
            switch (e.key.toLowerCase()) {
              case 'b': e.preventDefault(); this.format('bold'); break;
              case 'i': e.preventDefault(); this.format('italic'); break;
              case 'u': e.preventDefault(); this.format('underline'); break;
              case 'k': e.preventDefault(); this.format('link'); break;
              case 's': e.preventDefault(); this.download('html'); break;
            }
          }
        });
      }

      setupToolbar() {
        this.toolbar.querySelectorAll('[data-action]').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            this.format(btn.dataset.action);
            this.updateToolbarState();
          });
        });
        this.editor.addEventListener('mouseup', () => {
          this.updateToolbarState();
        });
        this.editor.addEventListener('keyup', (e) => {
          if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
          this.updateToolbarState();
        });
      }

      setupEvents() {
        this.editor.addEventListener('input', () => {
          this.debouncedSave();
          this.updateCounts();
        });
        this.editor.addEventListener('change', (e) => {
          if (e.target.type === 'checkbox') {
             if (e.target.checked) e.target.setAttribute('checked', 'true');
             else e.target.removeAttribute('checked');
             this.debouncedSave();
          }
        });
        this.editor.addEventListener('blur', () => this.save());
        this.editor.addEventListener('focus', () => this.restoreActiveStyles());
        window.addEventListener('hashchange', () => this.load());
        document.addEventListener('click', (e) => {
          if (!e.target.closest('.menu') && !e.target.closest('.fab')) this.hideMenu();
          
          if (e.target.classList.contains('modal-overlay')) {
            e.target.classList.remove('visible');
            // Specific cleanup for password modal if needed
            if (e.target.id === 'password-modal' && this._passwordReject) {
                this._passwordReject();
                this._passwordReject = null;
            }
          }
        });
      }

      updateCounts() {
        const text = this.editor.innerText || '';
        const chars = text.length;
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        document.getElementById('char-count').textContent = `${chars} characters`;
        document.getElementById('word-count').textContent = `${words} words`;
      }

      format(action) {
        const sel = window.getSelection();
        const hasSelection = sel && !sel.isCollapsed;
        
        const inlineMap = {
          'bold': 'bold',
          'italic': 'italic',
          'underline': 'underline',
          'strike': 'strikeThrough'
        };

        const cmd = inlineMap[action];

        if (cmd) {
          this.editor.focus();
          if (hasSelection) {
              document.execCommand(cmd);
              sel.collapseToEnd();
              if (document.queryCommandState(cmd)) {
                  document.execCommand(cmd);
              }
          } else {
              document.execCommand(cmd);
              this.saveActiveStyles();
          }
        }

        const blockType = this.getActiveBlockType();

        switch (action) {
          case 'h1': 
            this.editor.focus(); 
            document.execCommand('formatBlock', false, blockType === 'h1' ? 'div' : '<h1>'); 
            break;
          case 'h2': 
            this.editor.focus(); 
            document.execCommand('formatBlock', false, blockType === 'h2' ? 'div' : '<h2>'); 
            break;
          case 'h3': 
            this.editor.focus(); 
            document.execCommand('formatBlock', false, blockType === 'h3' ? 'div' : '<h3>'); 
            break;
          case 'ul': this.editor.focus(); document.execCommand('insertUnorderedList'); break;
          case 'ol': this.editor.focus(); document.execCommand('insertOrderedList'); break;
          case 'todo': this.editor.focus(); document.execCommand('insertHTML', false, '<input type="checkbox" style="margin-right:0.5rem; cursor:pointer;" contenteditable="false"> '); break;
          case 'quote': 
            this.editor.focus(); 
            const val = (document.queryCommandValue('formatBlock') || '').toLowerCase();
            const alreadyQuote = val.includes('blockquote');
            document.execCommand('formatBlock', false, alreadyQuote ? 'div' : 'blockquote'); 
            break;
          case 'code': this.editor.focus(); this.toggleCode(); break;
          case 'codeblock': this.editor.focus(); document.execCommand('formatBlock', false, '<pre>'); break;
          case 'link': 
            localStorage.removeItem('notes-active-styles');
            this.editor.focus(); 
            this.insertLink(); 
            break;
          case 'hr': 
            this.editor.focus();
            document.execCommand('insertHorizontalRule');
            document.execCommand('insertHTML', false, '<div><br></div>');
            break;
          case 'share': 
            localStorage.removeItem('notes-active-styles');
            this.share(); 
            break;
          case 'new': 
            localStorage.removeItem('notes-active-styles');
            this.newNote(); 
            break;
        }

        this.updateToolbarState();
      }

      saveActiveStyles() {
        const styles = ['bold', 'italic', 'underline', 'strikeThrough'].filter(cmd => document.queryCommandState(cmd));
        localStorage.setItem('notes-active-styles', JSON.stringify(styles));
      }

      restoreActiveStyles() {
        const saved = JSON.parse(localStorage.getItem('notes-active-styles') || '[]');
        saved.forEach(cmd => {
          if (!document.queryCommandState(cmd)) {
            document.execCommand(cmd);
          }
        });
        this.updateToolbarState();
      }

      handleResetFormatting() {
        const sel = window.getSelection();
        if (!sel || !sel.isCollapsed) return;
        this.saveActiveStyles();
      }

      toggleCode() {
        const sel = window.getSelection();
        if (!sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        const text = range.toString();
        if (!text) return;

        let node = sel.anchorNode;
        while (node && node !== this.editor) {
          if (node.nodeName === 'CODE') {
            node.parentNode.replaceChild(document.createTextNode(node.textContent), node);
            return;
          }
          node = node.parentNode;
        }

        const code = document.createElement('code');
        try { range.surroundContents(code); }
        catch { 
          const safeText = this.escapeHtml(text);
          document.execCommand('insertHTML', false, `<code>${safeText}</code>`); 
        }
      }

      async insertLink() {
        const selection = window.getSelection();
        if (!selection.rangeCount) return;
        const range = selection.getRangeAt(0).cloneRange();
        const text = range.toString();
        
        const url = await this.askPrompt('Insert Link URL', 'https://');
        if (!url) return;
        
        selection.removeAllRanges();
        selection.addRange(range);
        
        const sanitizedUrl = this.sanitizeUrl(url);
        if (!sanitizedUrl) {
          this.showToast('Invalid URL', 'error');
          return;
        }
        
        if (text) {
          document.execCommand('createLink', false, sanitizedUrl);
          this.editor.querySelectorAll(`a[href="${sanitizedUrl}"]`).forEach(a => {
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
          });
        } else {
          const safeText = this.escapeHtml(sanitizedUrl);
          document.execCommand('insertHTML', false, `<a href="${sanitizedUrl}" target="_blank" rel="noopener noreferrer">${safeText}</a>`);
        }
      }

      updateToolbarState() {
        const map = { 
          bold: 'bold', 
          italic: 'italic', 
          underline: 'underline', 
          strike: 'strikeThrough', 
          ul: 'insertUnorderedList', 
          ol: 'insertOrderedList' 
        };
        
        for (const [action, cmd] of Object.entries(map)) {
          const btn = this.toolbar.querySelector(`[data-action="${action}"]`);
          if (btn) {
            let isActive = document.queryCommandState(cmd);
            
            if (action === 'bold' && ['h1','h2','h3'].includes((document.queryCommandValue('formatBlock') || '').toLowerCase())) {
                isActive = false;
            }
            
            if (action === 'italic' && (document.queryCommandValue('formatBlock') || '').toLowerCase() === 'blockquote') {
                isActive = false;
            }
            
            btn.classList.toggle('active', isActive);
          }
        }

        const blockType = this.getActiveBlockType();
        ['h1', 'h2', 'h3', 'blockquote'].forEach(tag => {
          const action = tag === 'blockquote' ? 'quote' : tag;
          const btn = this.toolbar.querySelector(`[data-action="${action}"]`);
          if (btn) {
            btn.classList.toggle('active', blockType === tag);
          }
        });
      }

      getActiveBlockType() {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return '';
        const range = sel.getRangeAt(0);
        let node = range.commonAncestorContainer;
        if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
        
        while (node && node !== this.editor) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = node.tagName.toLowerCase();
            if (['h1', 'h2', 'h3', 'blockquote', 'pre'].includes(tag)) return tag;
          }
          node = node.parentNode;
        }
        return '';
      }

      async compress(str) {
        const s = new CompressionStream('deflate-raw');
        const w = s.writable.getWriter();
        w.write(new TextEncoder().encode(str));
        w.close();
        return new Uint8Array(await new Response(s.readable).arrayBuffer()).toBase64({ alphabet: 'base64url' });
      }

      async decompress(b64) {
        try {
          const s = new DecompressionStream('deflate-raw');
          const w = s.writable.getWriter();
          w.write(Uint8Array.fromBase64(b64, { alphabet: 'base64url' }));
          w.close();
          return new TextDecoder().decode(await new Response(s.readable).arrayBuffer());
        } catch { return ''; }
      }

      parsePayload(hash) {
          let p = hash.startsWith('#') ? hash.slice(1) : hash;
          let isReadonly = false;
          let isEncrypted = false;
          let expireTime = null;
          
          while (p.includes(':')) {
            if (p.startsWith('r:')) { isReadonly = true; p = p.slice(2); }
            else if (p.startsWith('e:')) { isEncrypted = true; p = p.slice(2); }
            else if (p.startsWith('t')) {
              let nextColon = p.indexOf(':');
              if (nextColon !== -1) {
                expireTime = parseInt(p.substring(1, nextColon));
                p = p.substring(nextColon + 1);
              } else break;
            }
            else break;
          }
          return { isReadonly, isEncrypted, expireTime, base64: p };
      }

      async load() {
        try {
          if (!location.hash || location.hash === '#') {
            this.editor.innerHTML = '';
            this.currentNoteId = null;
            this.updateTitle();
            this.updateCounts();
            return;
          }
          
          const existingNote = this.notes.find(n => n.hash === location.hash);
          this.currentNoteId = existingNote ? existingNote.id : null;

          let { isReadonly, isEncrypted, expireTime, base64: payload } = this.parsePayload(location.hash);
          this.isReadOnly = isReadonly;
          this.isEncrypted = isEncrypted;

          if (expireTime && Date.now() > expireTime) {
             this.editor.innerHTML = '<div style="text-align:center; padding: 3rem; color: var(--error);"><h2>Note Expired</h2><p>This note has reached its time limit and self-destructed.</p></div>';
             history.replaceState({}, '', location.pathname); 
             this.isReadOnly = true; 
             this.toolbar.style.display = 'none';
             this.editor.contentEditable = 'false';
             return;
          }
          
          if (this.isReadOnly) {
            this.editor.contentEditable = 'false';
            this.toolbar.style.display = 'none';
          } else {
            this.editor.contentEditable = 'true';
            this.toolbar.style.display = 'flex';
          }

          if (this.isEncrypted) {
            const password = await this.askPassword("Unlock Note", "This note is encrypted end-to-end. Enter password to unlock.");
            if (!password) {
               this.editor.innerHTML = '<div style="text-align:center; padding: 2rem; color: var(--text-secondary);">Note is encrypted. Reload to unlock.</div>';
               return;
            }
            try {
              payload = await this.decrypt(payload, password);
              this.currentPassword = password;
              this.showToast('Note unlocked');
            } catch (err) {
              this.editor.innerHTML = '<div style="text-align:center; padding: 2rem; color: var(--error);"><h2>Incorrect Password</h2><p>The password you entered is incorrect.</p><button onclick="app.load()" class="btn btn-primary" style="margin-top: 1rem; display: inline-flex; align-items: center; gap: 0.5rem;">Try Again</button></div>';
              return;
            }
          }
          
          const content = await this.decompress(payload);
          if (content) {
            this.editor.innerHTML = content;
          }
          this.updateTitle();
          this.updateCounts();
        } catch (e) { 
          console.error('Failed to load content:', e);
          this.editor.innerHTML = '';
          this.updateTitle();
        }
      }

      debouncedSave() {
        clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => this.save(), 500);
      }

      async save() {
        if (this.isReadOnly) return;
        try {
          const content = this.editor.innerHTML;
          if (!content || content === '<br>' || !content.trim()) {
            if (location.hash) history.replaceState({}, '', location.pathname);
            if (this.currentNoteId) {
               this.notes = this.notes.filter(n => n.id !== this.currentNoteId);
               localStorage.setItem('notes-library', JSON.stringify(this.notes));
               this.currentNoteId = null;
            }
            return;
          }
          let hashPayload = await this.compress(content);
          if (this.isEncrypted && this.currentPassword) {
            hashPayload = 'e:' + await this.encrypt(hashPayload, this.currentPassword);
          }
          const hash = '#' + hashPayload;
          
          if (!this.currentNoteId) {
              this.currentNoteId = 'note-' + Date.now();
              const textSnippet = this.editor.textContent.trim().split('\n')[0].substring(0, 30);
              const title = textSnippet || 'Untitled Note';
              this.notes.push({ id: this.currentNoteId, title: title, hash: hash, updatedAt: Date.now() });
          } else {
              const idx = this.notes.findIndex(n => n.id === this.currentNoteId);
              if (idx > -1) {
                  this.notes[idx].hash = hash;
                  this.notes[idx].updatedAt = Date.now();
                  const textSnippet = this.editor.textContent.trim().split('\n')[0].substring(0, 30);
                  this.notes[idx].title = textSnippet || 'Untitled Note';
              }
          }
          
          localStorage.setItem('notes-library', JSON.stringify(this.notes));

          if (location.hash !== hash) history.replaceState({}, '', hash);
          this.updateTitle();
        } catch (e) { console.error(e); }
      }

      updateTitle() {
        document.title = 'Browser Notes';
      }

      toggleMenu() {
        this.menu.classList.toggle('visible');
        this.fab.classList.toggle('active');
      }

      hideMenu() {
        this.menu.classList.remove('visible');
        this.fab.classList.remove('active');
      }

      showToast(msg, type = 'success') {
        this.toast.className = `toast ${type} visible`;
        this.toast.querySelector('.toast-message').textContent = msg;
        setTimeout(() => this.toast.classList.remove('visible'), 3000);
      }

      async newNote() {
        if (document.getElementById('library-modal').classList.contains('visible')) {
          document.getElementById('library-modal').classList.remove('visible');
        }
        
        this.editor.innerHTML = '';
        this.currentNoteId = null;
        this.isEncrypted = false;
        this.currentPassword = null;
        localStorage.removeItem('notes-active-styles');
        history.replaceState({}, '', location.pathname);
        this.updateTitle();
        this.updateCounts();
        this.editor.focus();
        this.updateToolbarState();
      }

      openLibrary() {
        this.hideMenu();
        const searchInput = document.getElementById('library-search');
        searchInput.value = '';
        
        const renderList = (filter = '') => {
            const listDiv = document.getElementById('library-list');
            listDiv.innerHTML = '';
            
            const filteredNotes = this.notes
                .filter(n => n.title.toLowerCase().includes(filter.toLowerCase()))
                .sort((a,b) => b.updatedAt - a.updatedAt);

            if (filteredNotes.length === 0) {
               listDiv.innerHTML = `<div style="color:var(--text-tertiary); text-align:center; padding: 1rem;">${filter ? 'No matches found.' : 'No saved notes yet.'}</div>`;
            } else {
               filteredNotes.forEach(n => {
                  const d = new Date(n.updatedAt).toLocaleString();
                  const div = document.createElement('div');
                  div.style = 'display:flex; justify-content:space-between; align-items:center; background:var(--bg-secondary); padding:0.75rem 1rem; border-radius:var(--radius-sm); border:1px solid var(--border);';
                  
                  const info = document.createElement('div');
                  info.style = 'cursor:pointer; flex: 1;';
                  info.innerHTML = `<strong>${this.escapeHtml(n.title)}</strong><br><span style="font-size:0.75rem; color:var(--text-tertiary);">${d}</span>`;
                  info.onclick = () => {
                     history.replaceState({}, '', n.hash);
                     this.load();
                     document.getElementById('library-modal').classList.remove('visible');
                  };

                  const del = document.createElement('button');
                  del.className = 'btn btn-error';
                  del.textContent = 'Delete';
                  del.style.padding = '0.4rem 0.8rem';
                  del.onclick = (e) => {
                     e.stopPropagation();
                     this.notes = this.notes.filter(x => x.id !== n.id);
                     localStorage.setItem('notes-library', JSON.stringify(this.notes));
                     if (this.currentNoteId === n.id) this.newNote();
                     renderList(searchInput.value);
                  };

                  div.appendChild(info);
                  div.appendChild(del);
                  listDiv.appendChild(div);
               });
            }
        };

        searchInput.oninput = (e) => renderList(e.target.value);
        renderList();
        
        localStorage.removeItem('notes-active-styles');
        this.updateToolbarState();

        document.getElementById('library-modal').classList.add('visible');
      }

      askShareType() {
        return new Promise(resolve => {
          const modal = document.getElementById('share-modal');
          const readonlyBtn = document.getElementById('share-readonly-btn');
          const editableBtn = document.getElementById('share-editable-btn');
          
          modal.classList.add('visible');
          
          const finish = (type) => {
            modal.classList.remove('visible');
            readonlyBtn.onclick = null;
            editableBtn.onclick = null;
            resolve(type);
          };
          
          localStorage.removeItem('notes-active-styles');
          this.updateToolbarState();
          
          readonlyBtn.onclick = () => finish('readonly');
          editableBtn.onclick = () => finish('editable');
        });
      }

      async share() {
        try {
          const shareType = await this.askShareType();
          if (!shareType) return;
          
          let { isEncrypted, expireTime, base64 } = this.parsePayload(location.hash);
          let newFlags = '';
          if (shareType === 'readonly') newFlags += 'r:';
          if (expireTime) newFlags += `t${expireTime}:`;
          if (isEncrypted || this.isEncrypted) newFlags += 'e:';
          
          const hash = '#' + newFlags + base64;
          const shareUrl = location.origin + location.pathname + hash;
          
          const success = await this.copyToClipboard(shareUrl);
          if (success) {
            this.showToast(shareType === 'readonly' ? 'Read-Only Link Copied!' : 'Link to Copy Copied!');
          } else {
            this.showToast('Copy failed', 'error');
          }
        } catch { this.showToast('Copy failed', 'error'); }
      }

      async copyContent() {
        const success = await this.copyToClipboard(this.editor.textContent);
        if (success) {
          this.showToast('Copied!');
        } else {
          this.showToast('Copy failed', 'error');
        }
      }

      async copyToClipboard(text) {
        try {
          if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
          }
          const textArea = document.createElement('textarea');
          textArea.value = text;
          textArea.style.position = 'fixed';
          textArea.style.left = '-9999px';
          textArea.style.top = '0';
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          const successful = document.execCommand('copy');
          document.body.removeChild(textArea);
          return successful;
        } catch (err) {
          return false;
        }
      }

      download(format) {
        const text = this.editor.textContent.trim();
        const chars = text.length;
        const words = text ? text.split(/\s+/).length : 0;
        const textSnippet = text.split('\n')[0].substring(0, 20).replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'note';
        const filename = `${textSnippet}_${words}w_${chars}c`;

        if (format === 'html') {
          const content = this.sanitizeHtml(this.editor.innerHTML);
          const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Notes</title><style>body{font-family:system-ui,sans-serif;max-width:800px;margin:0 auto;padding:2rem;line-height:1.6}code{background:#f5f5f5;padding:.2em .4em;border-radius:3px}blockquote{border-left:4px solid #3b82f6;padding-left:1rem;color:#666}pre{background:#f8f9fa;padding:1rem;border-radius:8px;overflow-x:auto}</style></head><body>${content}</body></html>`;
          this.downloadFile(html, `${filename}.html`, 'text/html');
        } else if (format === 'markdown') {
          this.downloadFile(this.htmlToMarkdown(this.editor), `${filename}.md`, 'text/markdown');
        } else {
          this.downloadFile(this.editor.textContent, `${filename}.txt`, 'text/plain');
        }
        this.showToast(`Downloaded ${format.toUpperCase()}`);
      }

      htmlToMarkdown(element) {
        let md = '';
        const children = element.childNodes;
        for (let i = 0; i < children.length; i++) {
          const child = children[i];
          if (child.nodeType === Node.TEXT_NODE) {
            md += child.textContent;
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            let inner = this.htmlToMarkdown(child);
            switch (child.tagName.toLowerCase()) {
              case 'h1': md += `\n# ${inner}\n\n`; break;
              case 'h2': md += `\n## ${inner}\n\n`; break;
              case 'h3': md += `\n### ${inner}\n\n`; break;
              case 'p': md += `\n${inner}\n\n`; break;
              case 'b': case 'strong': md += `**${inner}**`; break;
              case 'i': case 'em': md += `_${inner}_`; break;
              case 'u': md += `<u>${inner}</u>`; break;
              case 'strike': case 's': case 'del': md += `~~${inner}~~`; break;
              case 'a': md += `[${inner}](${child.href})`; break;
              case 'input':
                if (child.type === 'checkbox') {
                  md += child.checked || child.hasAttribute('checked') ? '[x] ' : '[ ] ';
                }
                break;
              case 'code': md += `\`${inner}\``; break;
              case 'pre': md += `\n\`\`\`\n${child.textContent}\n\`\`\`\n\n`; break;
              case 'blockquote': md += `\n> ${(' ' + inner).trim().replace(/\n/g, '\n> ')}\n\n`; break;
              case 'ul': case 'ol': md += `\n${inner}\n`; break;
              case 'li': 
                const isOl = child.parentNode && child.parentNode.tagName.toLowerCase() === 'ol';
                const prefix = isOl ? '1. ' : '- ';
                md += `${prefix}${inner}\n`; break;
              case 'hr': md += `\n---\n\n`; break;
              case 'br': md += `\n`; break;
              case 'div': 
                if (child.classList.contains('toolbar') || child.classList.contains('status-bar')) break;
                md += `\n${inner}`; break;
              default: md += inner; break;
            }
          }
        }
        return md.replace(/\n{3,}/g, '\n\n').trim();
      }

      downloadFile(content, name, type) {
        const url = URL.createObjectURL(new Blob([content], { type }));
        Object.assign(document.createElement('a'), { href: url, download: name }).click();
        URL.revokeObjectURL(url);
      }

      registerServiceWorker() {
        if ('serviceWorker' in navigator) {
          const swCode = `
            const CACHE_NAME = 'notes-app-final-v1';
            const ASSETS = ['./', 'index.html', 'style.css'];

            self.addEventListener('install', (e) => {
              e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
            });

            self.addEventListener('activate', (e) => {
              e.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE_NAME && caches.delete(k)))).then(() => self.clients.claim()));
            });

            self.addEventListener('fetch', (e) => {
              if (e.request.url.includes('app.js')) return e.respondWith(fetch(e.request));
              e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
            });
          `;
          const blob = new Blob([swCode], { type: 'application/javascript' });
          const url = URL.createObjectURL(blob);
          navigator.serviceWorker.register(url).catch(err => console.log('SW failed', err));
        }
      }

      async installApp() {
        if (!window.deferredPrompt) return;
        this.hideMenu();
        window.deferredPrompt.prompt();
        const { outcome } = await window.deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          document.getElementById('install-app-btn').style.display = 'none';
        }
        window.deferredPrompt = null;
      }

      sanitizeHtml(html) {
        return html;
      }

      escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }

      sanitizeUrl(url) {
        try {
          if (!url || typeof url !== 'string') return null;
          const trimmedUrl = url.trim();
          if (!trimmedUrl) return null;
          if (trimmedUrl.startsWith('javascript:') || trimmedUrl.startsWith('data:') || trimmedUrl.startsWith('vbscript:') || trimmedUrl.startsWith('file:')) return null;
          if (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://') || trimmedUrl.startsWith('/') || trimmedUrl.startsWith('./') || trimmedUrl.startsWith('../')) return trimmedUrl;
          if (trimmedUrl.includes('.') && !trimmedUrl.includes(' ')) return 'https://' + trimmedUrl;
          return null;
        } catch (e) {
          return null;
        }
      }

      async deriveKey(password, salt) {
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits', 'deriveKey']);
        return await crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: 600000, hash: 'SHA-256' },
          keyMaterial, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
        );
      }

      async encrypt(b64Data, password) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await this.deriveKey(password, salt);
        const encoded = new TextEncoder().encode(b64Data);
        const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, encoded);
        
        const bundle = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
        bundle.set(salt, 0);
        bundle.set(iv, salt.length);
        bundle.set(new Uint8Array(encrypted), salt.length + iv.length);
        
        return bundle.toBase64({ alphabet: 'base64url' });
      }

      async decrypt(b64Bundle, password) {
        const bundle = Uint8Array.fromBase64(b64Bundle, { alphabet: 'base64url' });
        const salt = bundle.slice(0, 16);
        const iv = bundle.slice(16, 28);
        const ciphertext = bundle.slice(28);
        
        const key = await this.deriveKey(password, salt);
        const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ciphertext);
        return new TextDecoder().decode(decrypted);
      }

      askPassword(title, body, isSetup = false) {
        return new Promise(resolve => {
          const modal = isSetup ? document.getElementById('set-password-modal') : document.getElementById('password-modal');
          const input = isSetup ? document.getElementById('set-password-input') : document.getElementById('password-input');
          const submitBtn = isSetup ? document.getElementById('set-password-submit') : document.getElementById('password-submit');
          const cancelBtn = document.getElementById('password-cancel');
          const removeBtn = document.getElementById('remove-password-btn');

          if (!isSetup) {
            document.getElementById('password-modal-title').textContent = title;
            document.getElementById('password-modal-body').textContent = body;
          } else {
             if (this.isEncrypted) {
               removeBtn.style.display = 'block';
             } else {
               removeBtn.style.display = 'none';
             }
          }

          input.value = '';
          modal.classList.add('visible');
          input.focus();

          const finish = (val) => {
            modal.classList.remove('visible');
            submitBtn.onclick = null;
            if (cancelBtn) cancelBtn.onclick = null;
            if (removeBtn) removeBtn.onclick = null;
            input.onkeydown = null;
            resolve(val);
          };

          submitBtn.onclick = () => finish(input.value);
          if (cancelBtn) cancelBtn.onclick = () => finish(null);
          if (removeBtn) removeBtn.onclick = () => finish(""); 
          input.onkeydown = (e) => {
            if (e.key === 'Enter') finish(input.value);
            if (e.key === 'Escape' && isSetup) finish(null);
          };
        });
      }

      async showProtectionModal() {
        this.hideMenu();
        if (!this.editor.textContent.trim()) {
           this.showToast('Please write something before encrypting.');
           return;
        }
        const pass = await this.askPassword('', '', true);
        if (pass === null) return;
        if (pass === "") {
          this.isEncrypted = false;
          this.currentPassword = null;
          this.showToast('Password removed');
          this.save();
          return;
        }
        this.isEncrypted = true;
        this.currentPassword = pass;
        this.showToast('Note encrypted');
        this.save();
      }

      askConfirm(title, body) {
        return new Promise(resolve => {
          const modal = document.getElementById('generic-confirm-modal');
          document.getElementById('gc-title').textContent = title;
          document.getElementById('gc-body').textContent = body;
          const confirmBtn = document.getElementById('gc-confirm');
          const cancelBtn = document.getElementById('gc-cancel');
          
          modal.classList.add('visible');
          
          const finish = (val) => {
            modal.classList.remove('visible');
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
            resolve(val);
          };
          
          confirmBtn.onclick = () => finish(true);
          cancelBtn.onclick = () => finish(false);
        });
      }

      askPrompt(title, defaultValue = '') {
        return new Promise(resolve => {
          const modal = document.getElementById('generic-prompt-modal');
          document.getElementById('gp-title').textContent = title;
          const input = document.getElementById('gp-input');
          const confirmBtn = document.getElementById('gp-confirm');
          const cancelBtn = document.getElementById('gp-cancel');
          
          input.value = defaultValue;
          modal.classList.add('visible');
          input.focus();
          
          const finish = (val) => {
            modal.classList.remove('visible');
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
            input.onkeydown = null;
            resolve(val);
          };
          
          confirmBtn.onclick = () => finish(input.value);
          cancelBtn.onclick = () => finish(null);
          input.onkeydown = (e) => {
            if (e.key === 'Enter') finish(input.value);
            if (e.key === 'Escape') finish(null);
          };
        });
      }
    }

    document.addEventListener('DOMContentLoaded', () => {
      window.app = new NotesApp();
    });

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      window.deferredPrompt = e;
      const btn = document.getElementById('install-app-btn');
      if (btn) btn.style.display = 'flex';
    });