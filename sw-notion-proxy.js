/**
 * Same-origin proxy for Notion API (frontend-only CORS workaround).
 * Intercepts fetch to /notion-api/* and forwards to https://api.notion.com/v1/*
 */
const NOTION_API_ORIGIN = 'https://api.notion.com';
const NOTION_API_PREFIX = '/v1';
const PROXY_PATH_MARKER = '/notion-api';

self.addEventListener('install', function (event) {
    self.skipWaiting();
});

self.addEventListener('activate', function (event) {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function (event) {
    const requestUrl = new URL(event.request.url);
    if (requestUrl.origin !== self.location.origin) {
        return;
    }

    const markerIndex = requestUrl.pathname.indexOf(PROXY_PATH_MARKER);
    if (markerIndex === -1) {
        return;
    }

    const notionPath =
        requestUrl.pathname.slice(markerIndex + PROXY_PATH_MARKER.length) +
        requestUrl.search;
    const notionUrl = NOTION_API_ORIGIN + NOTION_API_PREFIX + notionPath;

    event.respondWith(forwardNotionRequest(event.request, notionUrl));
});

async function forwardNotionRequest(clientRequest, notionUrl) {
    const method = clientRequest.method;
    const proxyInit = {
        method: method,
        headers: clientRequest.headers,
    };

    if (method !== 'GET' && method !== 'HEAD') {
        proxyInit.body = await clientRequest.clone().arrayBuffer();
    }

    return fetch(notionUrl, proxyInit);
}
