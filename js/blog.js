/**
 * Static blog — loads databases/blog_export.json and renders Notion-shaped blocks.
 * No Notion API, tokens, or service worker. Refresh the JSON export on deploy.
 */
(function (global) {
    'use strict';

    const LANDING_PAGE_BASE_URL = new URL('./', global.location.href);
    const BLOG_EXPORT_JSON_URL = new URL(
        'databases/blog_export.json',
        LANDING_PAGE_BASE_URL
    ).href;

    let blogExportLoadPromise = null;
    let cachedBlogExport = null;

    function escapeHtml(rawText) {
        return String(rawText)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function buildBlogExportLoadError(fetchError, httpStatus) {
        if (httpStatus === 404) {
            return (
                'No se encontró databases/blog_export.json. Copia el archivo generado ' +
                'por el export del servidor a landing-page/databases/.'
            );
        }
        if (fetchError && fetchError.message === 'Failed to fetch') {
            return (
                'No se pudo descargar databases/blog_export.json. Comprueba la conexión ' +
                'o que el archivo esté publicado junto al sitio.'
            );
        }
        return (
            (fetchError && fetchError.message) ||
            'Error desconocido al cargar el blog.'
        );
    }

    async function loadBlogExport() {
        if (cachedBlogExport) {
            return cachedBlogExport;
        }
        if (blogExportLoadPromise) {
            return blogExportLoadPromise;
        }

        blogExportLoadPromise = (async function () {
            let response;
            try {
                response = await fetch(BLOG_EXPORT_JSON_URL, { cache: 'no-cache' });
            } catch (networkError) {
                throw new Error(buildBlogExportLoadError(networkError));
            }
            if (!response.ok) {
                throw new Error(buildBlogExportLoadError(null, response.status));
            }
            let parsed;
            try {
                parsed = await response.json();
            } catch (parseError) {
                throw new Error(
                    'databases/blog_export.json no es JSON válido.'
                );
            }
            if (!parsed || !Array.isArray(parsed.pages)) {
                throw new Error(
                    'El export del blog no tiene el formato esperado (falta "pages").'
                );
            }
            if (!parsed.blocksByPageId || typeof parsed.blocksByPageId !== 'object') {
                parsed.blocksByPageId = {};
            }
            cachedBlogExport = parsed;
            return cachedBlogExport;
        })();

        return blogExportLoadPromise;
    }

    function isPublishedPage(page) {
        if (!page || page.object !== 'page') {
            return false;
        }
        if (page.in_trash === true || page.is_archived === true || page.archived === true) {
            return false;
        }
        return true;
    }

    async function queryAllDatabasePages() {
        const exportData = await loadBlogExport();
        const pages = exportData.pages.filter(isPublishedPage);
        pages.sort(function (pageA, pageB) {
            const timeA = Date.parse(pageA.last_edited_time || 0);
            const timeB = Date.parse(pageB.last_edited_time || 0);
            return timeB - timeA;
        });
        return pages;
    }

    function blockChildrenFromExport(parentId) {
        if (!cachedBlogExport || !parentId) {
            return [];
        }
        const blocksMap = cachedBlogExport.blocksByPageId;
        const listPayload = blocksMap[parentId];
        if (listPayload && Array.isArray(listPayload.results)) {
            return listPayload.results;
        }
        return [];
    }

    async function fetchAllBlockChildren(blockId) {
        await loadBlogExport();
        const fromMap = blockChildrenFromExport(blockId);
        if (fromMap.length) {
            return fromMap;
        }
        return [];
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

        await loadBlogExport();
        const blocks = await fetchAllBlockChildren(pageId);
        contentRoot.innerHTML = '';
        if (!blocks.length) {
            const emptyNote = document.createElement('p');
            emptyNote.className = 'blog-empty';
            emptyNote.textContent = 'Esta entrada no tiene contenido en el export.';
            contentRoot.appendChild(emptyNote);
            return;
        }
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
        const alertBox = document.createElement('div');
        alertBox.className = 'blog-error';
        alertBox.setAttribute('role', 'alert');
        alertBox.innerHTML =
            '<p><strong>No se pudo cargar el blog.</strong></p><p>' +
            escapeHtml(message) +
            '</p>';
        container.appendChild(alertBox);
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

        teaserGrid.innerHTML = '<p class="blog-loading">Cargando entradas…</p>';
        try {
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
            showBlogError(teaserGrid, teaserError.message);
        }
    }

    global.Blog = {
        initBlogPage: initBlogPage,
        initHomeBlogTeaser: initHomeBlogTeaser,
        queryAllDatabasePages: queryAllDatabasePages,
        loadBlogExport: loadBlogExport,
    };
})(window);
