/* Apply the same form sizing inside same-origin modules and report frames. */
(function () {
    'use strict';
    const source = document.currentScript?.src || location.href;
    const stylesheet = new URL('tg-form-focus.css?v=1.0.0', source).href;
    const documents = new WeakSet();

    function prepareFrame(frame) {
        try {
            if (frame.contentDocument) prepare(frame.contentDocument);
        } catch (_) { /* A remote attachment keeps its own presentation. */ }
    }

    function prepare(doc) {
        if (!doc.head || documents.has(doc)) return;
        documents.add(doc);
        if (!doc.getElementById('tg-form-focus-style')) {
            const link = doc.createElement('link');
            link.id = 'tg-form-focus-style';
            link.rel = 'stylesheet';
            link.href = stylesheet;
            doc.head.appendChild(link);
        }
        // Capture iframe loads, including srcdoc reports created after opening a modal.
        doc.addEventListener('load', event => {
            if (event.target?.localName === 'iframe') prepareFrame(event.target);
        }, true);
        doc.querySelectorAll('iframe').forEach(prepareFrame);
    }

    prepare(document);
})();
