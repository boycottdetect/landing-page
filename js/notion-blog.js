/**
 * Notion Blog — frontend-only client and block renderer.
 *
 * CORS: Notion's API does not send Access-Control-Allow-Origin. This module
 * registers sw-notion-proxy.js (same-origin) on HTTPS/localhost to forward
 * requests to api.notion.com. On file:// or without service workers, set
 * NOTION_CORS_PROXY to a trusted forward proxy.
 */
(function (global) {
    'use strict';

    const NOTION_API_BASE = 'https://api.notion.com/v1';
    const NOTION_VERSION = '2022-06-28';
    const NOTION_TOKEN = 'ntn_i41739681098odb3J1m0z8LNR2ntUtOsIdFCLGYBozccMo';
    const DATABASE_ID = '3d10f8c9b2ed805b836fd9c4095acb9b';

    const SERVICE_WORKER_SCRIPT_URL = new URL(
        'sw-notion-proxy.js',
        global.location.origin + '/'
    ).pathname;
    const SERVICE_WORKER_SCOPE = new URL('/', global.location.origin).pathname;
    const NOTION_PROXY_PATH_PREFIX = '/notion-api';

    /** Optional third-party CORS proxy prefix (empty = use service worker or direct) */
    const NOTION_CORS_PROXY = '';

    let serviceWorkerInitPromise = null;
    const SERVICE_WORKER_RELOAD_KEY = 'notion_sw_reload_attempted';

    function escapeHtml(rawText) {
        return String(rawText)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function buildNotionHeaders() {
        return {
            Authorization: 'Bearer ' + NOTION_TOKEN,
            'Notion-Version': NOTION_VERSION,
            'Content-Type': 'application/json',
        };
    }

    function serviceWorkerEnvironmentSupported() {
        return Boolean(global.isSecureContext && global.navigator.serviceWorker);
    }

    function hasServiceWorkerControl() {
        return Boolean(
            serviceWorkerEnvironmentSupported() &&
                global.navigator.serviceWorker.controller
        );
    }

    function waitForServiceWorkerControl(maxWaitMs) {
        const deadline = Date.now() + (maxWaitMs || 8000);
        return new Promise(function (resolve) {
            function checkControl() {
                if (hasServiceWorkerControl()) {
                    resolve(true);
                    return;
                }
                if (Date.now() >= deadline) {
                    resolve(false);
                    return;
                }
                setTimeout(checkControl, 100);
            }
            global.navigator.serviceWorker.addEventListener(
                'controllerchange',
                function () {
                    resolve(hasServiceWorkerControl());
                },
                { once: true }
            );
            checkControl();
        });
    }

    function reloadOnceForServiceWorkerControl() {
        if (sessionStorage.getItem(SERVICE_WORKER_RELOAD_KEY)) {
            return false;
        }
        sessionStorage.setItem(SERVICE_WORKER_RELOAD_KEY, '1');
        global.location.reload();
        return true;
    }

    async function ensureNotionServiceWorker() {
        if (!serviceWorkerEnvironmentSupported()) {
            return false;
        }
        if (NOTION_CORS_PROXY) {
            return false;
        }
        if (serviceWorkerInitPromise) {
            return serviceWorkerInitPromise;
        }

        serviceWorkerInitPromise = (async function () {
            try {
                const registration = await global.navigator.serviceWorker.register(
                    SERVICE_WORKER_SCRIPT_URL,
                    { scope: SERVICE_WORKER_SCOPE }
                );
                await global.navigator.serviceWorker.ready;

                if (!hasServiceWorkerControl()) {
                    await waitForServiceWorkerControl(6000);
                }
                if (!hasServiceWorkerControl() && registration.active) {
                    reloadOnceForServiceWorkerControl();
                    await new Promise(function () {
                        /* page reload in progress */
                    });
                }
                return hasServiceWorkerControl();
            } catch (registerError) {
                return false;
            }
        })();

        return serviceWorkerInitPromise;
    }

    function buildProxiedNotionUrl(apiPath) {
        return new URL(NOTION_PROXY_PATH_PREFIX + apiPath, global.location.origin)
            .href;
    }

    function buildRequestUrl(apiPath) {
        if (NOTION_CORS_PROXY) {
            return NOTION_CORS_PROXY + encodeURIComponent(NOTION_API_BASE + apiPath);
        }
        if (serviceWorkerEnvironmentSupported()) {
            return buildProxiedNotionUrl(apiPath);
        }
        return NOTION_API_BASE + apiPath;
    }

    function isLikelyNetworkOrCorsError(fetchError) {
        return (
            fetchError.message === 'Failed to fetch' ||
            fetchError.name === 'TypeError'
        );
    }

    function buildFetchFailureMessage(fetchError, usedProxyPath) {
        if (!serviceWorkerEnvironmentSupported()) {
            return (
                'No se pudo conectar con Notion. Abre el sitio por HTTPS o localhost ' +
                '(el proxy del service worker no está disponible en este entorno).'
            );
        }
        if (usedProxyPath && isLikelyNetworkOrCorsError(fetchError)) {
            return (
                'No se pudo conectar con Notion. Comprueba que sw-notion-proxy.js esté ' +
                'publicado en la raíz del sitio y se sirva con Content-Type: application/javascript. ' +
                'Recarga la página una vez tras la primera visita para activar el proxy.'
            );
        }
        if (isLikelyNetworkOrCorsError(fetchError)) {
            return (
                'No se pudo conectar con Notion (CORS). Recarga la página para activar el ' +
                'proxy del service worker, o configura NOTION_CORS_PROXY en notion-blog.js.'
            );
        }
        return fetchError.message;
    }

    async function attemptNotionFetch(requestUrl, fetchOptions) {
        const response = await fetch(requestUrl, fetchOptions);
        if (!response.ok) {
            let detail = response.statusText;
            try {
                const errorBody = await response.json();
                if (errorBody.message) {
                    detail = errorBody.message;
                }
            } catch (parseError) {
                /* use statusText */
            }
            if (
                response.status === 404 &&
                requestUrl.indexOf(NOTION_PROXY_PATH_PREFIX) !== -1
            ) {
                throw new Error(
                    'El proxy del service worker no respondió (404). Publica sw-notion-proxy.js ' +
                        'en la raíz del dominio y recarga la página.'
                );
            }
            throw new Error('Notion API ' + response.status + ': ' + detail);
        }
        return response.json();
    }

    async function fetchViaProxyWithRetry(apiPath, requestInit, preferProxy) {
        const proxyUrl = buildProxiedNotionUrl(apiPath);
        try {
            return await attemptNotionFetch(proxyUrl, requestInit);
        } catch (primaryError) {
            if (!preferProxy) {
                throw primaryError;
            }
            if (hasServiceWorkerControl()) {
                throw new Error(buildFetchFailureMessage(primaryError, true));
            }
            const gotControl = await waitForServiceWorkerControl(5000);
            if (gotControl) {
                try {
                    return await attemptNotionFetch(proxyUrl, requestInit);
                } catch (retryError) {
                    throw new Error(buildFetchFailureMessage(retryError, true));
                }
            }
            if (isLikelyNetworkOrCorsError(primaryError)) {
                throw new Error(buildFetchFailureMessage(primaryError, true));
            }
            throw primaryError;
        }
    }

    async function notionFetch(apiPath, fetchOptions) {
        await ensureNotionServiceWorker();

        const requestInit = Object.assign({}, fetchOptions, {
            headers: Object.assign({}, buildNotionHeaders(), fetchOptions.headers || {}),
            mode: 'cors',
        });

        const preferProxy =
            !NOTION_CORS_PROXY && serviceWorkerEnvironmentSupported();
        if (preferProxy) {
            return fetchViaProxyWithRetry(apiPath, requestInit, true);
        }
        return attemptNotionFetch(buildRequestUrl(apiPath), requestInit);
    }

    async function queryAllDatabasePages() {
        const pages = [];
        let cursor = undefined;
        let hasMore = true;

        while (hasMore) {
            const body = { page_size: 100 };
            if (cursor) {
                body.start_cursor = cursor;
            }
            const data = await notionFetch('/databases/' + DATABASE_ID + '/query', {
                method: 'POST',
                body: JSON.stringify(body),
            });
            pages.push.apply(pages, data.results || []);
            hasMore = data.has_more === true;
            cursor = data.next_cursor;
        }

        pages.sort(function (pageA, pageB) {
            const timeA = Date.parse(pageA.last_edited_time || 0);
            const timeB = Date.parse(pageB.last_edited_time || 0);
            return timeB - timeA;
        });

        return pages;
    }

    async function fetchAllBlockChildren(blockId) {
        const blocks = [];
        let cursor = undefined;
        let hasMore = true;

        while (hasMore) {
            let path = '/blocks/' + blockId + '/children?page_size=100';
            if (cursor) {
                path += '&start_cursor=' + encodeURIComponent(cursor);
            }
            const data = await notionFetch(path, { method: 'GET' });
            blocks.push.apply(blocks, data.results || []);
            hasMore = data.has_more === true;
            cursor = data.next_cursor;
        }

        return blocks;
    }

    function plainTextFromRichText(richTextArray) {
        if (!richTextArray || !richTextArray.length) {
            return '';
        }
        return richTextArray.map(function (segment) {
            return segment.plain_text || '';
        }).join('');
    }

    function appendRichText(parentElement, richTextArray) {
        if (!richTextArray || !richTextArray.length) {
            return;
        }

        richTextArray.forEach(function (segment) {
            const annotations = segment.annotations || {};
            const linkHref =
                segment.href ||
                (segment.text && segment.text.link && segment.text.link.url) ||
                null;

            let node = document.createTextNode(segment.plain_text || '');

            function wrap(tagName, className) {
                const wrapper = document.createElement(tagName);
                if (className) {
                    wrapper.className = className;
                }
                wrapper.appendChild(node);
                node = wrapper;
            }

            if (annotations.code) {
                wrap('code', 'notion-inline-code');
            }
            if (annotations.bold) {
                wrap('strong');
            }
            if (annotations.italic) {
                wrap('em');
            }
            if (annotations.strikethrough) {
                wrap('s');
            }
            if (annotations.underline) {
                wrap('u');
            }
            if (linkHref) {
                const anchor = document.createElement('a');
                anchor.href = linkHref;
                anchor.target = '_blank';
                anchor.rel = 'noopener noreferrer';
                anchor.appendChild(node);
                node = anchor;
            }

            parentElement.appendChild(node);
        });
    }

    function fileUrlFromNotionFile(fileObject) {
        if (!fileObject) {
            return null;
        }
        if (fileObject.type === 'external') {
            return fileObject.external && fileObject.external.url;
        }
        if (fileObject.type === 'file') {
            return fileObject.file && fileObject.file.url;
        }
        return null;
    }

    function pageTitle(page) {
        const titleProp = page.properties && page.properties.Name;
        if (!titleProp || titleProp.type !== 'title') {
            return 'Sin título';
        }
        const text = plainTextFromRichText(titleProp.title).trim();
        return text || 'Sin título';
    }

    function pageThumbnailUrl(page) {
        const thumbProp = page.properties && page.properties.Thumbnail;
        if (thumbProp && thumbProp.type === 'files' && thumbProp.files.length) {
            const url = fileUrlFromNotionFile(thumbProp.files[0]);
            if (url) {
                return url;
            }
        }
        if (page.cover) {
            return fileUrlFromNotionFile(page.cover);
        }
        return null;
    }

    function formatBlogDate(isoString) {
        if (!isoString) {
            return '';
        }
        try {
            return new Intl.DateTimeFormat('es-CL', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
            }).format(new Date(isoString));
        } catch (dateError) {
            return isoString.slice(0, 10);
        }
    }

    async function renderListItem(block, listTag) {
        const listItem = document.createElement('li');
        listItem.className = 'notion-list-item';
        const payload = block[block.type];
        appendRichText(listItem, payload.rich_text);

        if (block.has_children) {
            const nested = document.createElement(listTag === 'ol' ? 'ol' : 'ul');
            nested.className = 'notion-nested-list';
            const childBlocks = await fetchAllBlockChildren(block.id);
            await appendGroupedBlocks(nested, childBlocks);
            listItem.appendChild(nested);
        }

        return listItem;
    }

    async function renderSingleBlock(block) {
        const blockType = block.type;

        if (blockType === 'bulleted_list_item' || blockType === 'numbered_list_item') {
            return null;
        }

        let element = null;

        switch (blockType) {
            case 'paragraph': {
                element = document.createElement('p');
                appendRichText(element, block.paragraph.rich_text);
                if (!plainTextFromRichText(block.paragraph.rich_text)) {
                    element.className = 'notion-empty-paragraph';
                }
                break;
            }
            case 'heading_1':
                element = document.createElement('h1');
                appendRichText(element, block.heading_1.rich_text);
                break;
            case 'heading_2':
                element = document.createElement('h2');
                appendRichText(element, block.heading_2.rich_text);
                break;
            case 'heading_3':
                element = document.createElement('h3');
                appendRichText(element, block.heading_3.rich_text);
                break;
            case 'quote': {
                element = document.createElement('blockquote');
                element.className = 'notion-quote';
                appendRichText(element, block.quote.rich_text);
                break;
            }
            case 'divider':
                element = document.createElement('hr');
                element.className = 'notion-divider';
                break;
            case 'code': {
                const pre = document.createElement('pre');
                pre.className = 'notion-code-block';
                const codeEl = document.createElement('code');
                const language = block.code.language || '';
                if (language) {
                    codeEl.dataset.language = language;
                }
                codeEl.textContent = plainTextFromRichText(block.code.rich_text);
                pre.appendChild(codeEl);
                element = pre;
                break;
            }
            case 'callout': {
                element = document.createElement('aside');
                element.className = 'notion-callout notion-color-' + (block.callout.color || 'default');
                const iconSpan = document.createElement('span');
                iconSpan.className = 'notion-callout-icon';
                iconSpan.textContent = block.callout.icon && block.callout.icon.emoji
                    ? block.callout.icon.emoji
                    : '💡';
                const bodySpan = document.createElement('div');
                bodySpan.className = 'notion-callout-body';
                appendRichText(bodySpan, block.callout.rich_text);
                element.appendChild(iconSpan);
                element.appendChild(bodySpan);
                break;
            }
            case 'to_do': {
                element = document.createElement('div');
                element.className = 'notion-todo';
                const box = document.createElement('span');
                box.className = 'notion-todo-box';
                box.setAttribute('aria-hidden', 'true');
                box.textContent = block.to_do.checked ? '☑' : '☐';
                const label = document.createElement('span');
                label.className = 'notion-todo-text';
                appendRichText(label, block.to_do.rich_text);
                element.appendChild(box);
                element.appendChild(label);
                break;
            }
            case 'image': {
                element = document.createElement('figure');
                element.className = 'notion-image';
                const img = document.createElement('img');
                const imagePayload = block.image;
                const imageUrl =
                    imagePayload.type === 'external'
                        ? imagePayload.external.url
                        : fileUrlFromNotionFile(imagePayload);
                img.src = imageUrl || '';
                img.alt = plainTextFromRichText(imagePayload.caption) || 'Imagen';
                img.loading = 'lazy';
                element.appendChild(img);
                const captionText = plainTextFromRichText(imagePayload.caption);
                if (captionText) {
                    const caption = document.createElement('figcaption');
                    caption.textContent = captionText;
                    element.appendChild(caption);
                }
                break;
            }
            case 'bookmark': {
                element = document.createElement('a');
                element.className = 'notion-bookmark';
                element.href = block.bookmark.url;
                element.target = '_blank';
                element.rel = 'noopener noreferrer';
                element.textContent = block.bookmark.url;
                break;
            }
            case 'toggle': {
                element = document.createElement('details');
                element.className = 'notion-toggle';
                const summary = document.createElement('summary');
                appendRichText(summary, block.toggle.rich_text);
                element.appendChild(summary);
                if (block.has_children) {
                    const childWrap = document.createElement('div');
                    childWrap.className = 'notion-block-children';
                    const childBlocks = await fetchAllBlockChildren(block.id);
                    await appendGroupedBlocks(childWrap, childBlocks);
                    element.appendChild(childWrap);
                }
                break;
            }
            default: {
                if (block[blockType] && block[blockType].rich_text) {
                    element = document.createElement('p');
                    element.className = 'notion-fallback';
                    appendRichText(element, block[blockType].rich_text);
                } else {
                    element = document.createElement('p');
                    element.className = 'notion-unsupported';
                    element.textContent = '[Bloque no soportado: ' + blockType + ']';
                }
                break;
            }
        }

        const skipsChildPass =
            blockType === 'toggle' ||
            blockType === 'bulleted_list_item' ||
            blockType === 'numbered_list_item';

        if (element && block.has_children && !skipsChildPass) {
            const childWrap = document.createElement('div');
            childWrap.className = 'notion-block-children';
            const childBlocks = await fetchAllBlockChildren(block.id);
            await appendGroupedBlocks(childWrap, childBlocks);
            element.appendChild(childWrap);
        }

        return element;
    }

    async function appendGroupedBlocks(container, blocks) {
        let index = 0;
        while (index < blocks.length) {
            const current = blocks[index];
            const currentType = current.type;

            if (currentType === 'bulleted_list_item') {
                const listElement = document.createElement('ul');
                listElement.className = 'notion-bulleted-list';
                while (index < blocks.length && blocks[index].type === 'bulleted_list_item') {
                    listElement.appendChild(await renderListItem(blocks[index], 'ul'));
                    index += 1;
                }
                container.appendChild(listElement);
                continue;
            }

            if (currentType === 'numbered_list_item') {
                const orderedList = document.createElement('ol');
                orderedList.className = 'notion-numbered-list';
                while (index < blocks.length && blocks[index].type === 'numbered_list_item') {
                    orderedList.appendChild(await renderListItem(blocks[index], 'ol'));
                    index += 1;
                }
                container.appendChild(orderedList);
                continue;
            }

            const rendered = await renderSingleBlock(current);
            if (rendered) {
                container.appendChild(rendered);
            }
            index += 1;
        }
    }

    async function renderPageContent(pageId, contentRoot) {
        contentRoot.innerHTML = '';
        const loading = document.createElement('p');
        loading.className = 'blog-loading';
        loading.textContent = 'Cargando contenido…';
        contentRoot.appendChild(loading);

        const blocks = await fetchAllBlockChildren(pageId);
        contentRoot.innerHTML = '';
        const articleBody = document.createElement('div');
        articleBody.className = 'notion-article-body';
        await appendGroupedBlocks(articleBody, blocks);
        contentRoot.appendChild(articleBody);
    }

    function createBlogCard(page) {
        const card = document.createElement('article');
        card.className = 'blog-card';
        const pageId = page.id;
        const title = pageTitle(page);
        const thumbUrl = pageThumbnailUrl(page);
        const dateLabel = formatBlogDate(page.last_edited_time);

        const link = document.createElement('a');
        link.className = 'blog-card-link';
        link.href = 'blog.html#/post/' + pageId.replace(/-/g, '');
        link.setAttribute('aria-label', 'Leer: ' + title);

        const media = document.createElement('div');
        media.className = 'blog-card-media';
        if (thumbUrl) {
            const img = document.createElement('img');
            img.src = thumbUrl;
            img.alt = '';
            img.loading = 'lazy';
            media.appendChild(img);
        } else {
            media.classList.add('blog-card-media--placeholder');
            media.textContent = 'Blog';
        }

        const body = document.createElement('div');
        body.className = 'blog-card-body';
        const heading = document.createElement('h3');
        heading.textContent = title;
        const meta = document.createElement('time');
        meta.className = 'blog-card-date';
        meta.dateTime = page.last_edited_time || '';
        meta.textContent = dateLabel;

        body.appendChild(heading);
        body.appendChild(meta);
        link.appendChild(media);
        link.appendChild(body);
        card.appendChild(link);
        return card;
    }

    function showBlogError(container, message) {
        container.innerHTML = '';
        const alert = document.createElement('div');
        alert.className = 'blog-error';
        alert.setAttribute('role', 'alert');
        alert.innerHTML =
            '<p><strong>No se pudo cargar el blog.</strong></p><p>' +
            escapeHtml(message) +
            '</p>';
        container.appendChild(alert);
    }

    function normalizePageIdFromHash(rawId) {
        if (!rawId) {
            return null;
        }
        const compact = rawId.replace(/-/g, '');
        if (compact.length !== 32) {
            return rawId;
        }
        return (
            compact.slice(0, 8) +
            '-' +
            compact.slice(8, 12) +
            '-' +
            compact.slice(12, 16) +
            '-' +
            compact.slice(16, 20) +
            '-' +
            compact.slice(20)
        );
    }

    async function initBlogPage() {
        const listView = document.getElementById('blog-list-view');
        const postView = document.getElementById('blog-post-view');
        const grid = document.getElementById('blog-grid');
        const postTitle = document.getElementById('blog-post-title');
        const postDate = document.getElementById('blog-post-date');
        const postContent = document.getElementById('blog-post-content');
        const backButton = document.getElementById('blog-back-button');

        if (!listView || !postView || !grid) {
            return;
        }

        let cachedPages = null;

        async function ensurePages() {
            if (!cachedPages) {
                cachedPages = await queryAllDatabasePages();
            }
            return cachedPages;
        }

        function showList() {
            listView.hidden = false;
            postView.hidden = true;
            document.title = 'Blog | Boycott Detect';
        }

        async function showPost(pageId) {
            listView.hidden = true;
            postView.hidden = false;

            const pages = await ensurePages();
            const page = pages.find(function (entry) {
                return entry.id === pageId;
            });

            if (!page) {
                showBlogError(postContent, 'Entrada no encontrada.');
                return;
            }

            postTitle.textContent = pageTitle(page);
            postDate.textContent = formatBlogDate(page.last_edited_time);
            postDate.dateTime = page.last_edited_time || '';
            document.title = pageTitle(page) + ' | Boycott Detect';

            const heroUrl = pageThumbnailUrl(page);
            const hero = document.getElementById('blog-post-hero');
            if (hero) {
                hero.innerHTML = '';
                if (heroUrl) {
                    const img = document.createElement('img');
                    img.src = heroUrl;
                    img.alt = '';
                    img.className = 'blog-post-hero-img';
                    hero.appendChild(img);
                }
            }

            await renderPageContent(pageId, postContent);
        }

        async function routeFromHash() {
            const hash = window.location.hash || '';
            const postMatch = hash.match(/^#\/post\/([^/?]+)/);
            if (postMatch) {
                const pageId = normalizePageIdFromHash(postMatch[1]);
                try {
                    await showPost(pageId);
                } catch (routeError) {
                    showBlogError(postContent, routeError.message);
                }
                return;
            }
            showList();
        }

        backButton.addEventListener('click', function (event) {
            event.preventDefault();
            window.location.hash = '#/';
        });

        window.addEventListener('hashchange', routeFromHash);

        grid.innerHTML = '<p class="blog-loading">Cargando entradas…</p>';
        try {
            await ensureNotionServiceWorker();
            const pages = await ensurePages();
            grid.innerHTML = '';
            if (!pages.length) {
                grid.innerHTML = '<p class="blog-empty">Aún no hay publicaciones.</p>';
            } else {
                pages.forEach(function (page) {
                    grid.appendChild(createBlogCard(page));
                });
            }
            await routeFromHash();
        } catch (loadError) {
            showBlogError(grid, loadError.message);
        }
    }

    async function initHomeBlogTeaser(maxCards) {
        const teaserGrid = document.getElementById('home-blog-teaser-grid');
        if (!teaserGrid) {
            return;
        }

        const cardLimit = maxCards || 4;

        try {
            await ensureNotionServiceWorker();
            const pages = await queryAllDatabasePages();
            const slice = pages.slice(0, cardLimit);
            teaserGrid.innerHTML = '';
            if (!slice.length) {
                teaserGrid.innerHTML =
                    '<p class="blog-empty">Aún no hay publicaciones.</p>';
                return;
            }
            slice.forEach(function (page) {
                teaserGrid.appendChild(createBlogCard(page));
            });
        } catch (teaserError) {
            teaserGrid.innerHTML =
                '<p class="blog-teaser-fallback">' +
                'Visita el <a href="blog.html">blog</a> para leer nuestras publicaciones.</p>';
        }
    }

    global.NotionBlog = {
        initBlogPage: initBlogPage,
        initHomeBlogTeaser: initHomeBlogTeaser,
        queryAllDatabasePages: queryAllDatabasePages,
        ensureNotionServiceWorker: ensureNotionServiceWorker,
    };
})(window);
