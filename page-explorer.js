/**
 * Page Explorer - draw.io plugin
 * Collapsible, searchable tree of pages / page groups. Dock left, right, or float.
 *
 * Show/hide:  Ctrl+Shift+E, the "Pages" tab on the left edge, or Extras > Page Explorer
 * Dock mode:  header button, or Extras > Page Explorer: Change Dock
 * Reset:      Extras > Page Explorer: Reset Layout
 * Reorder:    drag pages in the list; drop on a group header to move to the end of that group
 * Add page:   + in the header, or hover a group and click its +
 * Delete:     hover a page and click the trash can (undo with Ctrl+Z)
 * Rename:     double-click a page, or hover and click the pencil (Enter = save, Esc = cancel)
 * Duplicate:  hover a page and click the copy icon
 * Sections:   folder icon in the header adds a section; hover a section header to
 *             rename / duplicate / delete it; drag a section header to reorder sections
 */
Draw.loadPlugin(function (ui) {
    'use strict';

    var STORAGE_KEY = 'pageExplorer.state';
    var UNGROUPED = '(Ungrouped)';
    var PREFIX_SEPARATOR = ' / ';
    var MIN_WIDTH = 180;
    var MAX_WIDTH = 500;
    var DEFAULTS = { visible: true, collapsed: {}, left: 70, top: 80, width: 260, dock: 'left' };

    // ---------- Persisted state ----------
    function cloneDefaults() { return JSON.parse(JSON.stringify(DEFAULTS)); }

    var state = cloneDefaults();
    try {
        var saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (saved) { for (var k in saved) { state[k] = saved[k]; } }
    } catch (e) { /* ignore */ }
    if (['left', 'right', 'float'].indexOf(state.dock) < 0) { state.dock = 'left'; }
    state.width = clamp(state.width, MIN_WIDTH, MAX_WIDTH);

    function saveState() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
    }

    function clamp(v, min, max) {
        v = parseFloat(v);
        if (!isFinite(v)) { return min; }
        return Math.min(max, Math.max(min, v));
    }

    function isDark() {
        return typeof Editor !== 'undefined' && typeof Editor.isDarkMode === 'function' && Editor.isDarkMode();
    }

    // ---------- Page helpers ----------
    function getPageName(page) {
        if (!page) { return 'Unnamed'; }
        if (typeof page.getName === 'function') { return page.getName() || 'Unnamed'; }
        return page.name || 'Unnamed';
    }

    function readAttr(node, names) {
        if (!node || typeof node.getAttribute !== 'function') { return null; }
        for (var i = 0; i < names.length; i++) {
            var v = node.getAttribute(names[i]);
            if (v) { return v; }
        }
        return null;
    }

    function getGroupNameLookup() {
        var lookup = {};
        var sources = [ui.pageGroups, ui.groups, ui.currentFile && ui.currentFile.pageGroups];
        sources.forEach(function (src) {
            if (!src) { return; }
            var list = Array.isArray(src) ? src : Object.keys(src).map(function (key) {
                var g = src[key];
                return typeof g === 'object' ? g : { id: key, name: g };
            });
            list.forEach(function (g) {
                if (g && g.id != null) { lookup[g.id] = g.name || g.title || g.label || g.id; }
            });
        });
        return lookup;
    }

    var GROUP_KEYS = ['group', 'groupId', 'pageGroup', 'groupName'];

    function getPageGroup(page, lookup) {
        var raw = null, source = null, key = null;
        for (var i = 0; i < GROUP_KEYS.length && !raw; i++) {
            if (page[GROUP_KEYS[i]]) { raw = page[GROUP_KEYS[i]]; source = 'prop'; key = GROUP_KEYS[i]; }
        }
        for (var j = 0; j < GROUP_KEYS.length && !raw; j++) {
            var v = readAttr(page.node, [GROUP_KEYS[j]]);
            if (v) { raw = v; source = 'attr'; key = GROUP_KEYS[j]; }
        }

        if (raw && typeof raw === 'object') {
            return { group: raw.name || raw.title || raw.id || UNGROUPED, label: getPageName(page), source: source, key: key, raw: raw };
        }
        if (raw) {
            return { group: lookup[raw] || raw, label: getPageName(page), source: source, key: key, raw: raw };
        }
        var name = getPageName(page);
        var idx = name.indexOf(PREFIX_SEPARATOR);
        if (idx > 0) {
            return { group: name.substring(0, idx), label: name.substring(idx + PREFIX_SEPARATOR.length), source: 'prefix' };
        }
        return { group: UNGROUPED, label: name, source: null };
    }

    function buildTree() {
        var lookup = getGroupNameLookup();
        var order = [];
        var groups = {};
        (ui.pages || []).forEach(function (page) {
            var info = getPageGroup(page, lookup);
            if (!groups[info.group]) { groups[info.group] = []; order.push(info.group); }
            groups[info.group].push({ page: page, label: info.label, info: info });
        });
        return { order: order, groups: groups };
    }

    function openPage(page) {
        if (page && page !== ui.currentPage && typeof ui.selectPage === 'function') {
            ui.selectPage(page);
        }
    }

    // ---------- Page actions ----------
    function pageIndex(page) { return (ui.pages || []).indexOf(page); }

    // insertAt = position in the current array (0..length) where the page should land
    function movePageTo(page, insertAt) {
        var from = pageIndex(page);
        if (from < 0 || typeof ui.movePage !== 'function') { return; }
        var to = insertAt > from ? insertAt - 1 : insertAt;   // index after removal
        if (to === from) { return; }
        ui.movePage(from, to);                                 // undoable (Ctrl+Z)
        render();
    }

    // Copy the group marker from a page already in the target group onto `page`.
    // Moving to (Ungrouped) clears the marker. Returns true if the group was changed.
    function assignGroup(page, groupName) {
        var lookup = getGroupNameLookup();
        var current = getPageGroup(page, lookup);
        if (current.group === groupName) { return true; }

        var tree = buildTree();
        var sample = (tree.groups[groupName] || []).filter(function (i) { return i.page !== page; })[0];
        var changed = false;

        try {
            // Clear the old marker
            if (current.source === 'prop' && current.key) { delete page[current.key]; page[current.key] = undefined; changed = true; }
            if (current.source === 'attr' && current.key && page.node) { page.node.removeAttribute(current.key); changed = true; }
            if (current.source === 'prefix') {
                setPageName(page, current.label);
                changed = true;
            }

            // Apply the new marker
            if (groupName !== UNGROUPED && sample) {
                var info = sample.info;
                if (info.source === 'prop') { page[info.key] = info.raw; changed = true; }
                else if (info.source === 'attr' && page.node) { page.node.setAttribute(info.key, info.raw); changed = true; }
                else if (info.source === 'prefix') {
                    setPageName(page, groupName + PREFIX_SEPARATOR + getPageGroup(page, lookup).label);
                    changed = true;
                }
            }
        } catch (e) {
            console.warn('Page Explorer: could not change group', e);
            return false;
        }

        if (changed) { markChanged(); }
        return getPageGroup(page, getGroupNameLookup()).group === groupName;
    }

    function setPageName(page, name) {
        // 1) Undoable draw.io command
        try {
            if (typeof RenamePage === 'function' && ui.editor && ui.editor.graph) {
                ui.editor.graph.model.execute(new RenamePage(ui, page, name));
                if (getPageName(page) === name) { return true; }
            }
        } catch (e) { console.warn('Page Explorer: RenamePage failed, using fallback', e); }

        // 2) Direct rename
        try {
            if (typeof page.setName === 'function') { page.setName(name); }
            else if (page.node) { page.node.setAttribute('name', name); }
            markChanged();
        } catch (e) { console.error('Page Explorer: rename failed', e); }

        return getPageName(page) === name;
    }

    // Rename keeps the "Group / " prefix when grouping comes from page names
    function renamePage(item, newLabel) {
        newLabel = (newLabel || '').trim();
        if (!newLabel || newLabel === item.label) { return; }
        var full = item.info.source === 'prefix'
            ? item.info.group + PREFIX_SEPARATOR + newLabel
            : newLabel;
        if (!setPageName(item.page, full)) {
            showToast('Rename failed. Press F12 and check the Console for details.');
        }
        render();
    }

    function duplicatePage(item) {
        var page = item.page;
        var name = getPageName(page) + ' copy';
        var copy = duplicateRaw(page, name);
        if (!copy) {
            showToast('Duplicate failed. Press F12 and check the Console for details.');
            render();
            return;
        }
        if (copy !== page) {
            var want = pageIndex(page) + 1;
            if (pageIndex(copy) !== want) { movePageTo(copy, want); }
            assignGroup(copy, item.info.group);
            openPage(copy);
        }
        render();
    }

    // Returns the new page (or null). Does not reposition or regroup it.
    function duplicateRaw(page, name) {
        var copy = null;
        var before = (ui.pages || []).slice();
        try {
            openPage(page);                              // load the page's content first
            var graph = ui.editor && ui.editor.graph;
            if (graph && graph.isEditing && graph.isEditing()) { graph.stopEditing(); }

            if (typeof ui.duplicatePage === 'function') {
                copy = ui.duplicatePage(ui.currentPage, name);
            }
            if (!copy) {
                var a = ui.actions.get('duplicatePage');
                if (a) { a.funct(); }
            }
            if (!copy) {                                 // find whichever page is new
                copy = (ui.pages || []).filter(function (p) { return before.indexOf(p) < 0; })[0] || null;
            }
        } catch (e) {
            console.error('Page Explorer: duplicate failed', e);
        }

        if (copy && copy !== page && getPageName(copy) !== name) { setPageName(copy, name); }
        return copy && copy !== page ? copy : null;
    }

    function markChanged() {
        if (ui.currentFile && typeof ui.currentFile.setModified === 'function') { ui.currentFile.setModified(true); }
        if (typeof ui.updateTabContainer === 'function') { ui.updateTabContainer(); }
        if (ui.editor && typeof ui.editor.setModified === 'function') { ui.editor.setModified(true); }
    }

    // Move a page to a position and (optionally) into a group
    function dropPage(page, insertAt, groupName) {
        movePageTo(page, insertAt);
        if (groupName != null && !assignGroup(page, groupName)) {
            showToast('Moved, but could not change the group. Use right-click on the page tab > Group.');
        }
        render();
    }

    function deletePage(page) {
        if (!page) { return; }
        if ((ui.pages || []).length <= 1) { showToast('Cannot delete the only page.'); return; }
        if (!window.confirm('Delete page "' + getPageName(page) + '"?\n\nYou can undo with Ctrl+Z.')) { return; }
        removeRaw(page);
        render();
    }

    function removeRaw(page) {
        if (typeof ui.removePage === 'function') {
            ui.removePage(page);
        } else {
            if (page !== ui.currentPage) { openPage(page); }
            var a = ui.actions.get('deletePage') || ui.actions.get('removePage');
            if (a) { a.funct(); }
        }
    }

    // ---------- Section (page group) actions ----------
    // A section's "marker" is how its pages are tagged: a page property, an XML
    // attribute, or a "Section / Page" name prefix. These helpers work with all three.
    function sectionInfo(groupName) {
        var items = buildTree().groups[groupName] || [];
        var tagged = items.filter(function (i) { return i.info.source; })[0];
        return { items: items, info: tagged ? tagged.info : null };
    }

    // Template marker from any grouped page in the file (used for brand-new sections)
    function anyMarker() {
        var tree = buildTree();
        for (var i = 0; i < tree.order.length; i++) {
            var info = sectionInfo(tree.order[i]).info;
            if (info) { return info; }
        }
        return { source: 'prefix' };
    }

    // Tag a page as belonging to section `name`, using the same storage as `template`
    function tagPage(page, template, name) {
        var label = getPageGroup(page, getGroupNameLookup()).label;
        var source = template.source;
        if (source === 'prefix') {
            return setPageName(page, name + PREFIX_SEPARATOR + label);
        }
        var nameStored = template.raw === template.group || typeof template.raw === 'object';
        if (!nameStored) { return false; }   // stored by id; new ids are not supported
        var value = typeof template.raw === 'object'
            ? Object.assign({}, template.raw, { name: name })
            : name;
        if (source === 'prop') { page[template.key] = value; }
        if (source === 'attr' && page.node) { page.node.setAttribute(template.key, value); }
        markChanged();
        return true;
    }

    function sectionExists(name) { return !!buildTree().groups[name]; }

    function renameSection(groupName, newName) {
        newName = (newName || '').trim();
        if (!newName || newName === groupName || groupName === UNGROUPED) { return; }
        if (sectionExists(newName)) { showToast('A section named "' + newName + '" already exists.'); return; }
        var sec = sectionInfo(groupName);
        var info = sec.info;
        var ok = false;

        if (info && info.raw !== info.group && typeof info.raw !== 'object') {
            // Stored by id: rename the entry in draw.io's group list
            [ui.pageGroups, ui.groups, ui.currentFile && ui.currentFile.pageGroups].forEach(function (src) {
                if (!src) { return; }
                var list = Array.isArray(src) ? src : Object.keys(src).map(function (k) { return src[k]; });
                list.forEach(function (g) {
                    if (g && g.id === info.raw) { g.name = newName; ok = true; }
                });
                if (!Array.isArray(src) && typeof src[info.raw] === 'string') { src[info.raw] = newName; ok = true; }
            });
            if (ok) { markChanged(); }
        } else if (info) {
            ok = true;
            sec.items.forEach(function (i) { ok = tagPage(i.page, info, newName) && ok; });
        }

        if (state.collapsed[groupName]) { state.collapsed[newName] = true; delete state.collapsed[groupName]; saveState(); }
        if (!ok || !sectionExists(newName)) {
            showToast('Could not rename this section. Run Extras > Page Explorer: Debug Page Data and check the Console.');
        }
        render();
    }

    function deleteSection(groupName) {
        var items = sectionInfo(groupName).items;
        if (!items.length) { return; }
        if (items.length >= (ui.pages || []).length) {
            showToast('Cannot delete every page in the file.');
            return;
        }
        if (!window.confirm('Delete section "' + groupName + '" and its ' + items.length +
            ' page(s)?\n\nYou can undo with Ctrl+Z.')) { return; }
        items.forEach(function (i) { removeRaw(i.page); });
        delete state.collapsed[groupName];
        saveState();
        render();
    }

    function uniqueSectionName(base) {
        var name = base, n = 2;
        while (sectionExists(name)) { name = base + ' ' + n++; }
        return name;
    }

    function duplicateSection(groupName) {
        var sec = sectionInfo(groupName);
        var template = groupName === UNGROUPED ? null : (sec.info || anyMarker());
        var newName = uniqueSectionName(groupName + ' copy');
        var prev = sec.items.length ? sec.items[sec.items.length - 1].page : null;
        var failedTag = false, failedCopy = false, last = null;

        sec.items.forEach(function (i) {
            var copy = duplicateRaw(i.page, i.label);
            if (!copy) { failedCopy = true; return; }
            movePageTo(copy, pageIndex(prev) + 1);       // keep copies together, in order
            prev = copy;
            last = last || copy;
            if (template && !tagPage(copy, template, newName)) { failedTag = true; }
        });

        if (last) { openPage(last); }
        if (failedCopy) { showToast('Some pages could not be duplicated. Check the Console (F12).'); }
        else if (failedTag) { showToast('Pages copied, but the new section could not be created. Group them with right-click > Group.'); }
        render();
    }

    function addSection() {
        var name = window.prompt('New section name:', uniqueSectionName('New Section'));
        name = (name || '').trim();
        if (!name) { return; }
        if (sectionExists(name)) { showToast('A section named "' + name + '" already exists.'); return; }
        var before = (ui.pages || []).slice();
        addPage(null);
        var page = (ui.pages || []).filter(function (p) { return before.indexOf(p) < 0; })[0];
        if (!page) { return; }
        setPageName(page, 'New Page');
        if (!tagPage(page, anyMarker(), name)) {
            showToast('Page added, but the section could not be created. Use right-click on the page tab > Group > New.');
        }
        state.collapsed[name] = false;
        saveState();
        render();
    }

    // Move every page of `groupName` so the section lands before/after `targetGroup`
    function moveSection(groupName, targetGroup, after) {
        if (groupName === targetGroup) { return; }
        var tree = buildTree();
        var pages = (tree.groups[groupName] || []).map(function (i) { return i.page; });
        var target = (tree.groups[targetGroup] || []).map(function (i) { return i.page; });
        if (!pages.length || !target.length) { return; }

        var at = after ? pageIndex(target[target.length - 1]) + 1 : pageIndex(target[0]);
        movePageTo(pages[0], at);
        for (var i = 1; i < pages.length; i++) {
            movePageTo(pages[i], pageIndex(pages[i - 1]) + 1);
        }
        render();
    }

    var toastTimer = null;
    function showToast(msg) {
        var t = document.getElementById('pe-toast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'pe-toast';
            t.className = 'pe-toast';
            t.setAttribute('role', 'status');
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.style.display = 'block';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.style.display = 'none'; }, 4000);
    }

    function addPage(groupName) {
        if (typeof ui.insertPage !== 'function') {
            var a = ui.actions.get('insertPage');
            if (a) { a.funct(); }
            return;
        }
        var tree = buildTree();
        var items = groupName ? tree.groups[groupName] : null;
        var last = items && items.length ? items[items.length - 1] : null;
        var index = last ? pageIndex(last.page) + 1 : (ui.pages || []).length;

        var name = 'New Page';
        if (last && last.info.source === 'prefix') { name = groupName + PREFIX_SEPARATOR + name; }

        var page = ui.createPage ? ui.createPage(name, ui.createPageId ? ui.createPageId() : undefined) : null;
        page = ui.insertPage(page || undefined, index);

        // Best effort: copy the group marker from the group's last page
        if (page && last && last.info.key) {
            try {
                if (last.info.source === 'prop') { page[last.info.key] = last.info.raw; }
                if (last.info.source === 'attr' && page.node) { page.node.setAttribute(last.info.key, last.info.raw); }
            } catch (e) { /* ignore */ }
        }
        if (page && typeof ui.selectPage === 'function') { ui.selectPage(page); }
        render();
    }

    // ---------- Styles ----------
    var style = document.createElement('style');
    style.textContent = [
        '.pe-panel{position:absolute;z-index:1000;display:flex;flex-direction:column;box-sizing:border-box;',
        '  font:13px/1.3 Helvetica,Arial,sans-serif;background:#fff;color:#222;',
        '  border:1px solid #c4c4c4;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.18);overflow:hidden}',
        '.pe-panel.pe-dark,.pe-reopen.pe-dark{background:#2a2a2a;color:#e6e6e6;border-color:#505050}',
        '.pe-docked{border-radius:0;box-shadow:none}',
        '.pe-header{display:flex;align-items:center;gap:2px;padding:6px 8px;font-weight:bold;',
        '  background:rgba(0,0,0,.05);user-select:none;cursor:move}',
        '.pe-docked .pe-header{cursor:default}',
        '.pe-header span{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
        '.pe-icon{border:0;background:transparent;color:inherit;cursor:pointer;padding:2px 6px;border-radius:3px;font-size:13px}',
        '.pe-icon:hover{background:rgba(0,0,0,.1)}',
        '.pe-search{margin:6px 8px;padding:5px 7px;border:1px solid #bbb;border-radius:4px;font-size:12px;',
        '  background:inherit;color:inherit}',
        '.pe-body{flex:1;overflow:auto;padding:0 4px 6px}',
        '.pe-group{display:flex;align-items:center;width:100%;border:0;background:transparent;color:inherit;',
        '  text-align:left;cursor:pointer;padding:5px 6px;font-weight:bold;border-radius:4px}',
        '.pe-group:hover,.pe-page:hover{background:rgba(0,0,0,.07)}',
        '.pe-caret{display:inline-block;width:14px;font-size:10px}',
        '.pe-count{margin-left:auto;font-weight:normal;opacity:.6;font-size:11px}',
        '.pe-page{display:block;width:100%;border:0;background:transparent;color:inherit;text-align:left;',
        '  cursor:pointer;padding:4px 6px 4px 26px;border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.pe-page.pe-active{background:#dbeafe;color:#1d4ed8;font-weight:bold}',
        '.pe-dark .pe-page.pe-active{background:#1e3a5f;color:#93c5fd}',
        '.pe-empty{padding:8px;opacity:.6;font-style:italic}',
        '.pe-page.pe-dragging{opacity:.4}',
        '.pe-page{position:relative}',
        '.pe-page:hover{padding-right:72px}',
        '.pe-actions{position:absolute;right:2px;top:50%;transform:translateY(-50%);display:none;gap:1px}',
        '.pe-page:hover .pe-actions{display:flex}',
        '.pe-act{padding:0 4px;border-radius:3px;font-size:12px;opacity:.7;font-weight:normal}',
        '.pe-act:hover{opacity:1;background:rgba(0,0,0,.12)}',
        '.pe-act.pe-danger:hover{background:rgba(220,38,38,.18)}',
        '.pe-rename{display:block;box-sizing:border-box;width:calc(100% - 20px);margin:1px 0 1px 20px;padding:3px 6px;',
        '  border:1px solid #1d4ed8;border-radius:4px;font:13px Helvetica,Arial,sans-serif;background:inherit;color:inherit}',
        '.pe-toast{position:fixed;bottom:40px;left:50%;transform:translateX(-50%);z-index:2000;display:none;',
        '  padding:8px 14px;border-radius:6px;background:#333;color:#fff;font:12px Helvetica,Arial,sans-serif;',
        '  box-shadow:0 2px 8px rgba(0,0,0,.3)}',
        '.pe-drop-before{box-shadow:inset 0 2px 0 #1d4ed8}',
        '.pe-drop-after{box-shadow:inset 0 -2px 0 #1d4ed8}',
        '.pe-group.pe-drop-into{background:rgba(29,78,216,.15)}',
        '.pe-group .pe-add{visibility:hidden;margin-left:4px;padding:0 6px;border-radius:3px;font-weight:normal}',
        '.pe-group .pe-act{display:none}',
        '.pe-group:hover .pe-act{display:inline-block}',
        '.pe-group:hover .pe-count{display:none}',
        '.pe-group.pe-dragging{opacity:.4}',
        '.pe-group.pe-drop-before{box-shadow:inset 0 2px 0 #1d4ed8}',
        '.pe-group.pe-drop-after{box-shadow:inset 0 -2px 0 #1d4ed8}',
        '.pe-rename-section{width:100%;margin-left:0;font-weight:bold}',
        '.pe-group:hover .pe-add{visibility:visible}',
        '.pe-group .pe-add:hover{background:rgba(0,0,0,.12)}',
        '.pe-grip{position:absolute;top:0;bottom:0;width:6px;cursor:ew-resize;z-index:2}',
        '.pe-grip:hover{background:rgba(29,78,216,.25)}',
        '.pe-reopen{position:fixed;left:0;top:45%;z-index:1000;writing-mode:vertical-rl;transform:rotate(180deg);',
        '  padding:10px 5px;border:1px solid #c4c4c4;border-left:0;border-radius:0 6px 6px 0;background:#fff;color:#222;',
        '  font:12px Helvetica,Arial,sans-serif;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.18)}',
        '.pe-reopen:hover{background:#dbeafe;color:#1d4ed8}'
    ].join('\n');
    document.head.appendChild(style);

    // ---------- Panel DOM ----------
    var panel = document.createElement('div');
    panel.className = 'pe-panel';

    var header = document.createElement('div');
    header.className = 'pe-header';
    var title = document.createElement('span');
    title.textContent = 'Page Explorer';
    header.appendChild(title);

    function iconButton(text, tip, onClick) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'pe-icon';
        b.textContent = text;
        b.title = tip;
        b.addEventListener('mousedown', function (e) { e.stopPropagation(); });
        b.addEventListener('click', onClick);
        return b;
    }

    header.appendChild(iconButton('+', 'Add page', function () { addPage(null); }));
    header.appendChild(iconButton('\uD83D\uDCC1', 'Add section', function () { addSection(); }));
    header.appendChild(iconButton('⊞', 'Expand all', function () { setAllCollapsed(false); }));
    header.appendChild(iconButton('⊟', 'Collapse all', function () { setAllCollapsed(true); }));
    var dockBtn = iconButton('', '', function () { cycleDock(); });
    header.appendChild(dockBtn);
    header.appendChild(iconButton('✕', 'Hide - reopen with the Pages tab or Ctrl+Shift+E', function () { setVisible(false); }));

    var search = document.createElement('input');
    search.className = 'pe-search';
    search.type = 'search';
    search.placeholder = 'Filter pages...';
    search.addEventListener('input', render);
    search.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Enter') {
            var first = body.querySelector('.pe-page');
            if (first) { first.click(); }
        }
    });

    var body = document.createElement('div');
    body.className = 'pe-body';

    // Resize grip (left or right edge depending on dock)
    var grip = document.createElement('div');
    grip.className = 'pe-grip';

    panel.appendChild(header);
    panel.appendChild(search);
    panel.appendChild(body);
    panel.appendChild(grip);
    document.body.appendChild(panel);

    var reopenTab = document.createElement('button');
    reopenTab.type = 'button';
    reopenTab.className = 'pe-reopen';
    reopenTab.textContent = '☰ Pages';
    reopenTab.title = 'Show Page Explorer (Ctrl+Shift+E)';
    reopenTab.addEventListener('click', function () { setVisible(true); });
    document.body.appendChild(reopenTab);

    // ---------- Tree rendering ----------
    function setAllCollapsed(value) {
        buildTree().order.forEach(function (g) { state.collapsed[g] = value; });
        saveState();
        render();
    }

    var dragPage = null;
    var dragGroup = null;
    var editing = false;
    var lastClick = { page: null, time: 0 };

    function startRename(row, item) {
        inlineEdit(row, item.label, 'Page name', '', function (v) { renamePage(item, v); });
    }

    function startSectionRename(row, groupName) {
        inlineEdit(row, groupName, 'Section name', 'pe-rename-section', function (v) { renameSection(groupName, v); });
    }

    function inlineEdit(row, value, ariaLabel, extraClass, onCommit) {
        editing = true;
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'pe-rename' + (extraClass ? ' ' + extraClass : '');
        input.value = value;
        input.setAttribute('aria-label', ariaLabel);
        if (!row.parentNode) { editing = false; return; }
        row.parentNode.replaceChild(input, row);

        var done = false;
        var ready = false;
        // draw.io may grab focus right after the click; wait, then focus the box
        setTimeout(function () {
            input.focus();
            input.select();
            setTimeout(function () { ready = true; }, 150);
        }, 0);

        function finish(commit) {
            if (done) { return; }
            done = true;
            editing = false;
            if (commit) { onCommit(input.value); }
            render();
        }
        input.addEventListener('keydown', function (e) {
            e.stopPropagation();                       // keep draw.io shortcuts out
            if (e.key === 'Enter') { e.preventDefault(); finish(true); }
            if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        });
        input.addEventListener('blur', function () {
            if (!ready) { setTimeout(function () { if (!done) { input.focus(); } }, 0); return; }
            finish(true);
        });
        ['mousedown', 'click', 'dblclick'].forEach(function (t) {
            input.addEventListener(t, function (e) { e.stopPropagation(); });
        });
    }

    function render() {
        if (editing) { return; }
        panel.classList.toggle('pe-dark', isDark());
        body.innerHTML = '';
        var filter = search.value.trim().toLowerCase();
        var tree = buildTree();

        tree.order.forEach(function (groupName) {
            var items = tree.groups[groupName].filter(function (item) {
                return !filter || item.label.toLowerCase().indexOf(filter) >= 0 ||
                    groupName.toLowerCase().indexOf(filter) >= 0;
            });
            if (items.length === 0) { return; }

            var hasActive = items.some(function (i) { return i.page === ui.currentPage; });
            var collapsed = !filter && state.collapsed[groupName] && !hasActive;

            var gBtn = document.createElement('button');
            gBtn.type = 'button';
            gBtn.className = 'pe-group';
            var caret = document.createElement('span');
            caret.className = 'pe-caret';
            caret.textContent = collapsed ? '▶' : '▼';
            gBtn.appendChild(caret);
            gBtn.appendChild(document.createTextNode(groupName));
            var count = document.createElement('span');
            count.className = 'pe-count';
            count.textContent = items.length;
            gBtn.appendChild(count);

            var add = document.createElement('span');
            add.className = 'pe-add';
            add.textContent = '+';
            add.title = 'Add page to ' + groupName;
            add.addEventListener('click', function (e) {
                e.stopPropagation();
                addPage(groupName);
            });
            gBtn.appendChild(add);

            function sectionAction(icon, tip, fn, cls) {
                var a = document.createElement('span');
                a.className = 'pe-act' + (cls ? ' ' + cls : '');
                a.textContent = icon;
                a.title = tip;
                a.setAttribute('role', 'button');
                a.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); });
                a.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
                gBtn.appendChild(a);
            }
            if (groupName !== UNGROUPED) {
                sectionAction('\u270E', 'Rename section', function () { startSectionRename(gBtn, groupName); });
            }
            sectionAction('\u29C9', 'Duplicate section', function () { duplicateSection(groupName); });
            sectionAction('\uD83D\uDDD1', 'Delete section and its pages', function () { deleteSection(groupName); }, 'pe-danger');

            // Drag a section header to reorder sections (disabled while filtering)
            gBtn.draggable = !filter;
            gBtn.addEventListener('dragstart', function (e) {
                dragGroup = groupName;
                gBtn.classList.add('pe-dragging');
                e.dataTransfer.effectAllowed = 'move';
                try { e.dataTransfer.setData('text/plain', groupName); } catch (err) { /* ignore */ }
            });
            gBtn.addEventListener('dragend', function () {
                dragGroup = null;
                gBtn.classList.remove('pe-dragging');
            });

            function clearDrop() { gBtn.classList.remove('pe-drop-into', 'pe-drop-before', 'pe-drop-after'); }

            gBtn.addEventListener('dragover', function (e) {
                if (dragPage) {                                  // page -> end of this section
                    e.preventDefault();
                    gBtn.classList.add('pe-drop-into');
                } else if (dragGroup && dragGroup !== groupName) { // section -> before/after this one
                    e.preventDefault();
                    var r = gBtn.getBoundingClientRect();
                    var after = e.clientY > r.top + r.height / 2;
                    gBtn.classList.toggle('pe-drop-after', after);
                    gBtn.classList.toggle('pe-drop-before', !after);
                }
            });
            gBtn.addEventListener('dragleave', clearDrop);
            gBtn.addEventListener('drop', function (e) {
                e.preventDefault();
                var after = gBtn.classList.contains('pe-drop-after');
                clearDrop();
                if (dragGroup) {
                    var g = dragGroup;
                    dragGroup = null;
                    moveSection(g, groupName, after);
                    return;
                }
                if (!dragPage) { return; }
                var all = tree.groups[groupName].filter(function (i) { return i.page !== dragPage; });
                var at = all.length ? pageIndex(all[all.length - 1].page) + 1 : pageIndex(dragPage);
                dropPage(dragPage, at, groupName);
            });

            gBtn.addEventListener('click', function () {
                state.collapsed[groupName] = !collapsed;
                saveState();
                render();
            });
            body.appendChild(gBtn);

            if (collapsed) { return; }

            items.forEach(function (item) {
                var pBtn = document.createElement('button');
                pBtn.type = 'button';
                pBtn.className = 'pe-page' + (item.page === ui.currentPage ? ' pe-active' : '');
                pBtn.textContent = item.label;
                pBtn.title = item.label;
                var actions = document.createElement('span');
                actions.className = 'pe-actions';
                function rowAction(icon, tip, fn, cls) {
                    var a = document.createElement('span');
                    a.className = 'pe-act' + (cls ? ' ' + cls : '');
                    a.textContent = icon;
                    a.title = tip;
                    a.setAttribute('role', 'button');
                    a.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
                    a.addEventListener('dblclick', function (e) { e.stopPropagation(); });
                    a.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); });
                    actions.appendChild(a);
                }
                rowAction('\u270E', 'Rename page (or double-click)', function () { startRename(pBtn, item); });
                rowAction('\u29C9', 'Duplicate page', function () { duplicatePage(item); });
                rowAction('\uD83D\uDDD1', 'Delete page', function () { deletePage(item.page); }, 'pe-danger');
                pBtn.appendChild(actions);
                pBtn.addEventListener('click', function () {
                    var now = Date.now();
                    if (lastClick.page === item.page && now - lastClick.time < 450) {
                        lastClick = { page: null, time: 0 };
                        startRename(pBtn, item);
                        return;
                    }
                    lastClick = { page: item.page, time: now };
                    if (item.page !== ui.currentPage) { openPage(item.page); render(); }
                });

                // Drag & drop reordering (disabled while filtering)
                pBtn.draggable = !filter;
                pBtn.addEventListener('dragstart', function (e) {
                    dragPage = item.page;
                    pBtn.classList.add('pe-dragging');
                    e.dataTransfer.effectAllowed = 'move';
                    try { e.dataTransfer.setData('text/plain', item.label); } catch (err) { /* ignore */ }
                });
                pBtn.addEventListener('dragend', function () {
                    dragPage = null;
                    pBtn.classList.remove('pe-dragging');
                });
                pBtn.addEventListener('dragover', function (e) {
                    if (!dragPage || dragPage === item.page) { return; }
                    e.preventDefault();
                    var r = pBtn.getBoundingClientRect();
                    var after = e.clientY > r.top + r.height / 2;
                    pBtn.classList.toggle('pe-drop-after', after);
                    pBtn.classList.toggle('pe-drop-before', !after);
                });
                pBtn.addEventListener('dragleave', function () {
                    pBtn.classList.remove('pe-drop-after', 'pe-drop-before');
                });
                pBtn.addEventListener('drop', function (e) {
                    e.preventDefault();
                    var after = pBtn.classList.contains('pe-drop-after');
                    pBtn.classList.remove('pe-drop-after', 'pe-drop-before');
                    if (dragPage && dragPage !== item.page) {
                        dropPage(dragPage, pageIndex(item.page) + (after ? 1 : 0), groupName);
                    }
                });

                body.appendChild(pBtn);
            });
        });

        if (body.children.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'pe-empty';
            empty.textContent = filter ? 'No matching pages' : 'No pages';
            body.appendChild(empty);
        }
    }

    // ---------- Docking / layout ----------
    // Offsets are applied relative to draw.io's own value, never on top of our previous
    // offset. This is what stops the canvas from drifting further each time the layout refreshes.
    function setOffset(el, prop, amount) {
        if (!el) { return; }
        var rec = el.__peOffset && el.__peOffset[prop];
        var cur = parseFloat(el.style[prop]);
        var base;
        if (rec && isFinite(cur) && Math.abs(cur - rec.applied) < 0.5) {
            base = rec.base;                  // still our value: undo our previous offset
        } else if (isFinite(cur)) {
            base = cur;                       // draw.io set a fresh value
        } else {
            if (amount === 0) { return; }     // nothing to undo
            base = 0;
        }
        var value = base + amount;
        el.style[prop] = value + 'px';
        el.__peOffset = el.__peOffset || {};
        el.__peOffset[prop] = { base: base, applied: value };
        if (amount === 0) { delete el.__peOffset[prop]; }
    }

    function dockedSide() {
        return state.visible && state.dock !== 'float' ? state.dock : null;
    }

    var laying = false;
    function applyLayout() {
        if (laying) { return; }
        laying = true;
        try {
            dockBtn.textContent = { left: '⇤', right: '⇥', float: '◱' }[state.dock];
            dockBtn.title = 'Dock: ' + state.dock + ' (click to change)';

            var side = dockedSide();
            var w = state.width;
            var dc = ui.diagramContainer;
            var shifted = [dc, ui.tabContainer, ui.hsplit].filter(Boolean);

            // Always set both sides so switching modes cleanly removes old offsets
            shifted.forEach(function (el) {
                setOffset(el, 'left', side === 'left' ? w : 0);
                setOffset(el, 'right', side === 'right' ? w : 0);
            });

            panel.classList.toggle('pe-docked', !!side);
            panel.style.width = w + 'px';

            if (side && dc) {
                var r = dc.getBoundingClientRect();
                panel.style.position = 'fixed';
                panel.style.top = r.top + 'px';
                panel.style.height = Math.max(100, r.height) + 'px';
                panel.style.maxHeight = 'none';
                panel.style.left = (side === 'left' ? r.left - w : r.right) + 'px';
                grip.style.display = 'block';
                grip.style.left = side === 'left' ? '' : '0';
                grip.style.right = side === 'left' ? '0' : '';
            } else {
                // Floating: keep it on screen
                state.left = clamp(state.left, 0, Math.max(0, window.innerWidth - 60));
                state.top = clamp(state.top, 0, Math.max(0, window.innerHeight - 40));
                panel.style.position = 'fixed';
                panel.style.left = state.left + 'px';
                panel.style.top = state.top + 'px';
                panel.style.height = '';
                panel.style.maxHeight = '75vh';
                grip.style.display = 'block';
                grip.style.left = '';
                grip.style.right = '0';
            }

            if (ui.editor && ui.editor.graph) { ui.editor.graph.sizeDidChange(); }
        } finally {
            laying = false;
        }
    }

    // Re-apply after every draw.io layout pass
    var originalRefresh = ui.refresh;
    ui.refresh = function () {
        var result = originalRefresh.apply(ui, arguments);
        try { applyLayout(); } catch (e) { console.warn('Page Explorer layout:', e); }
        return result;
    };

    function relayout() {
        if (typeof ui.refresh === 'function') { ui.refresh(); } else { applyLayout(); }
    }

    function cycleDock() {
        var order = ['left', 'right', 'float'];
        state.dock = order[(order.indexOf(state.dock) + 1) % order.length];
        saveState();
        relayout();
    }

    function setVisible(v) {
        state.visible = v;
        panel.style.display = v ? 'flex' : 'none';
        reopenTab.style.display = v ? 'none' : 'block';
        reopenTab.classList.toggle('pe-dark', isDark());
        saveState();
        if (v) { render(); }
        relayout();
    }

    function resetLayout() {
        var collapsed = state.collapsed;
        state = cloneDefaults();
        state.collapsed = collapsed;
        saveState();
        setVisible(true);
    }

    // ---------- Drag (floating only) ----------
    header.addEventListener('mousedown', function (e) {
        if (state.dock !== 'float') { return; }
        var startX = e.clientX, startY = e.clientY;
        var startLeft = state.left, startTop = state.top;
        function move(ev) {
            state.left = startLeft + ev.clientX - startX;
            state.top = startTop + ev.clientY - startY;
            panel.style.left = clamp(state.left, 0, window.innerWidth - 60) + 'px';
            panel.style.top = clamp(state.top, 0, window.innerHeight - 40) + 'px';
        }
        function up() {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            applyLayout();
            saveState();
        }
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
        e.preventDefault();
    });

    // ---------- Resize via edge grip ----------
    // Only the canvas re-layout happens on release, so the page does not jump while dragging.
    grip.addEventListener('mousedown', function (e) {
        var startX = e.clientX;
        var startW = state.width;
        var sign = state.dock === 'right' ? -1 : 1;
        function move(ev) {
            state.width = clamp(startW + sign * (ev.clientX - startX), MIN_WIDTH, MAX_WIDTH);
            panel.style.width = state.width + 'px';
        }
        function up() {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            saveState();
            relayout();
        }
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
        e.preventDefault();
        e.stopPropagation();
    });

    window.addEventListener('resize', function () { applyLayout(); });

    // ---------- Shortcut + menu ----------
    document.addEventListener('keydown', function (e) {
        if (e.ctrlKey && e.shiftKey && (e.key === 'E' || e.key === 'e')) {
            e.preventDefault();
            e.stopPropagation();
            setVisible(!state.visible);
        }
    }, true);

    ui.actions.addAction('pageExplorerToggle', function () { setVisible(!state.visible); });
    ui.actions.addAction('pageExplorerDock', function () { cycleDock(); });
    ui.actions.addAction('pageExplorerReset', function () { resetLayout(); });
    ui.actions.addAction('pageExplorerDebug', function () {
        console.group('Page Explorer debug');
        console.log('state:', JSON.parse(JSON.stringify(state)));
        (ui.pages || []).forEach(function (p, i) {
            var attrs = {};
            if (p.node && p.node.attributes) {
                for (var a = 0; a < p.node.attributes.length; a++) {
                    attrs[p.node.attributes[a].name] = p.node.attributes[a].value;
                }
            }
            console.log(i, getPageName(p), { ownKeys: Object.keys(p), nodeAttributes: attrs });
        });
        console.groupEnd();
        alert('Page details written to the browser console (F12).');
    });

    var labels = {
        pageExplorerToggle: 'Page Explorer',
        pageExplorerDock: 'Page Explorer: Change Dock (Left / Right / Floating)',
        pageExplorerReset: 'Page Explorer: Reset Layout',
        pageExplorerDebug: 'Page Explorer: Debug Page Data'
    };
    Object.keys(labels).forEach(function (id) {
        var a = ui.actions.get(id);
        if (a) { a.label = labels[id]; }
    });

    var extrasMenu = ui.menus.get('extras');
    if (extrasMenu) {
        var oldFunct = extrasMenu.funct;
        extrasMenu.funct = function (menu, parent) {
            oldFunct.apply(this, arguments);
            menu.addSeparator(parent);
            ui.menus.addMenuItems(menu, Object.keys(labels), parent);
        };
    }

    // ---------- Keep tree in sync ----------
    var lastSignature = '';
    function signature() {
        var lookup = getGroupNameLookup();
        return (ui.pages || []).map(function (p) {
            var g = getPageGroup(p, lookup);
            return g.group + '|' + g.label + (p === ui.currentPage ? '*' : '');
        }).join('\n');
    }
    window.setInterval(function () {
        if (!state.visible) { return; }
        var sig = signature();
        if (sig !== lastSignature) { lastSignature = sig; render(); }
    }, 750);

    setVisible(state.visible);
});
