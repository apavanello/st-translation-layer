// Translation Layer — the chat LLM only ever sees English; you read and write
// in your own language. Canonical `mes` stays EN, your language lives in
// `extra.display_text` (rendered natively by ST). See docs/ for the full design.

import {
    extension_settings,
    renderExtensionTemplateAsync,
    getContext,
} from '../../../extensions.js';
import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    saveChatConditional,
    updateMessageBlock,
    getRequestHeaders,
} from '../../../../script.js';
import { callGenericPopup, POPUP_TYPE } from '../../../popup.js';
import { createTranslationService, TranslationError } from './lib/translate.js';

const EXTENSION_NAME = 'st-translation-layer';
const MASKED_GENERATION_TYPES = ['normal', 'swipe', 'continue', 'regenerate'];

const DEFAULT_SETTINGS = {
    enabled: true,
    baseUrl: '',
    apiKey: '',
    model: '',
    language: 'pt-BR',
    languageOther: '',
    translateReasoning: false,
    showOriginalDuringStream: false,
    viaSt: true,
};

const LANGUAGES = [
    ['pt-BR', 'Português (Brasil)'],
    ['pt-PT', 'Português (Portugal)'],
    ['es', 'Español'],
    ['fr', 'Français'],
    ['de', 'Deutsch'],
    ['it', 'Italiano'],
    ['ru', 'Русский'],
    ['ja', '日本語'],
    ['ko', '한국어'],
    ['zh-CN', '中文（简体）'],
    ['pl', 'Polski'],
    ['nl', 'Nederlands'],
    ['tr', 'Türkçe'],
    ['uk', 'Українська'],
    ['_other', 'Other…'],
];

extension_settings[EXTENSION_NAME] = extension_settings[EXTENSION_NAME] || {};
const settings = Object.assign({}, DEFAULT_SETTINGS, extension_settings[EXTENSION_NAME]);
extension_settings[EXTENSION_NAME] = settings;

const service = createTranslationService(() => settings, { getHeaders: () => getRequestHeaders() });

const runtime = {
    viewingOriginal: new Set(), // messageIds whose DOM shows the canonical EN instead of the translation
    editBaseline: new Map(), // messageId -> display_text loaded into the edit textarea by us
    handling: new Set(), // messageIds with an edit handler in flight
    pendingRerender: new Set(), // messageIds mutated on MESSAGE_EDITED, waiting for MESSAGE_UPDATED render
};

function hash(text) {
    let h = 0;
    for (let i = 0; i < text.length; i++) {
        h = (h << 5) - h + text.charCodeAt(i);
        h |= 0;
    }
    return h;
}

function getChat() {
    return getContext().chat;
}

function getMessage(messageId) {
    return getChat()[messageId];
}

function isConfigured() {
    return Boolean(settings.enabled && settings.baseUrl && settings.model);
}

function effectiveLanguage() {
    return settings.language === '_other'
        ? (settings.languageOther.trim() || 'English')
        : settings.language;
}

function makeProvenance(direction, mesText, displayText) {
    return {
        lang: effectiveLanguage(),
        direction,
        model: settings.model,
        ts: Date.now(),
        mesHash: hash(mesText),
        dispHash: hash(displayText),
    };
}

function setChip(messageId, on) {
    const $mes = $(`.mes[mesid="${messageId}"]`);
    if (on) {
        if (!$mes.find('.st-tl-chip').length) {
            $mes.find('.ch_name').first().append($('<span>', { class: 'st-tl-chip', text: 'translating…' }));
        }
    } else {
        $mes.find('.st-tl-chip').remove();
    }
}

function maskStream(on) {
    $('#chat').toggleClass('st-tl-mask', on);
}

function decorateMessage(messageId) {
    const message = getMessage(messageId);
    if (!message?.extra?.translation || message.extra.translation.skip) return;
    const $area = $(`.mes[mesid="${messageId}"] .extraMesButtons`).first();
    if (!$area.length) return;
    if (!$area.children('.st-tl-view').length) {
        $area.append(
            $('<div>', { class: 'mes_button st-tl-view fa-solid fa-language', title: 'View original / translation' }),
            $('<div>', { class: 'mes_button st-tl-retry fa-solid fa-rotate', title: 'Re-translate' }),
        );
    }
    $area.children('.st-tl-retry').toggleClass('st-tl-failed', Boolean(message.extra.translation_failed));
}

function decorateAll() {
    const chat = getChat();
    for (let i = 0; i < chat.length; i++) decorateMessage(i);
}

async function askRetry(error, what) {
    const result = await callGenericPopup(
        `Translation Layer could not translate ${what} (<b>${error.classification}</b>).<br>Retry, or send it <b>untranslated</b>? Untranslated content goes to the prompt in your language.`,
        POPUP_TYPE.CONFIRM,
        '',
        { okButton: 'Retry', cancelButton: 'Send untranslated' },
    );
    return Boolean(result);
}

// ---- Outgoing: user message (own language) -> canonical EN, before generation ----

async function onMessageSent(messageId) {
    const message = getMessage(messageId);
    if (!settings.enabled || message?.is_system) return;
    if (message?.extra?.translation) return;
    if (!isConfigured()) return;

    const userText = message.mes;
    setChip(messageId, true);
    let en = null;
    try {
        for (;;) {
            try {
                en = await service.translate(userText, { direction: 'user->en' });
                break;
            } catch (error) {
                if (!(error instanceof TranslationError) || error.classification === 'not_configured') throw error;
                if (!await askRetry(error, 'your message')) break;
            }
        }
        message.extra ??= {};
        if (en === null) {
            message.extra.translation = { skip: true, ts: Date.now() };
        } else {
            message.extra.display_text = userText;
            message.mes = en;
            message.extra.translation = makeProvenance('user->en', en, userText);
        }
    } catch (error) {
        console.error('[Translation Layer] outgoing translation failed, sending untranslated', error);
        message.extra ??= {};
        message.extra.translation = { skip: true, ts: Date.now() };
    } finally {
        setChip(messageId, false);
        await saveChatConditional();
        updateMessageBlock(messageId, message);
        decorateMessage(messageId);
    }
}

// ---- Incoming: canonical EN -> display in the user's language ----

async function onMessageReceived(messageId) {
    maskStream(false);
    if (!isConfigured()) return;
    const message = getMessage(messageId);
    if (!message || message.is_system) return;
    const provenance = message.extra?.translation;
    const stale = provenance && hash(message.mes) !== provenance.mesHash;
    if (provenance && !stale) return;

    setChip(messageId, true);
    try {
        const translated = await service.translate(message.mes, { direction: 'en->user' });
        message.extra ??= {};
        message.extra.display_text = translated;
        message.extra.translation = makeProvenance('en->user', message.mes, translated);
        delete message.extra.translation_failed;
        if (settings.translateReasoning && typeof message.extra.reasoning === 'string' && message.extra.reasoning.trim()) {
            try {
                message.extra.reasoning = await service.translate(message.extra.reasoning, { direction: 'en->user' });
            } catch (reasoningError) {
                console.warn('[Translation Layer] reasoning not translated', reasoningError);
            }
        }
    } catch (error) {
        console.warn('[Translation Layer] incoming translation failed', error);
        message.extra ??= {};
        message.extra.translation_failed = true;
        delete message.extra.display_text; // show the canonical EN rather than a stale translation
        toastr.warning('Translation Layer: message shown in English — press ↻ on the message to retry the translation.', '', { timeOut: 8000 });
    } finally {
        setChip(messageId, false);
        await saveChatConditional();
        updateMessageBlock(messageId, message);
        decorateMessage(messageId);
    }
}

// ---- Edits: the side that changed gets the other side re-translated ----

function waitForElement(selector, timeoutMs = 2000) {
    return new Promise((resolve) => {
        const started = Date.now();
        (function poll() {
            const $el = $(selector);
            if ($el.length) return resolve($el);
            if (Date.now() - started > timeoutMs) return resolve($());
            setTimeout(poll, 50);
        })();
    });
}

// ST's edit dialog loads the canonical `mes` (EN). Swap the textarea to the
// user's translation so edits happen in their language (Q5/FR-6).
function onEditClick() {
    const messageId = Number($(this).closest('.mes').attr('mesid'));
    const message = getMessage(messageId);
    if (!isConfigured() || !message?.extra?.display_text) return;
    waitForElement('#curEditTextarea').then(($textarea) => {
        if (!$textarea.length) return;
        const display = message.extra.display_text;
        $textarea.val(display).trigger('input');
        runtime.editBaseline.set(messageId, display);
    });
}

async function handleEdit(messageId, { rerender }) {
    if (!isConfigured()) return;
    const message = getMessage(messageId);
    if (!message?.extra?.translation || message.extra.translation.skip) return;
    if (runtime.handling.has(messageId)) return;

    const baseline = runtime.editBaseline.get(messageId);

    if (baseline !== undefined) {
        // Edited through our swapped textarea: the new `mes` is in the user's language.
        runtime.editBaseline.delete(messageId);
        const edited = message.mes;
        if (edited === baseline) {
            if (rerender) updateMessageBlock(messageId, message);
            return;
        }
        runtime.handling.add(messageId);
        try {
            const en = await service.translate(edited, { direction: 'user->en' });
            message.extra.display_text = edited;
            message.mes = en;
            message.extra.translation = makeProvenance('user->en', en, edited);
            delete message.extra.translation_failed;
        } catch (error) {
            console.warn('[Translation Layer] edit re-translation failed; prompt keeps the edited text as-is', error);
            message.extra.translation = makeProvenance('user->en', edited, edited);
            toastr.warning('Translation Layer: could not re-translate your edit — this one message goes to the prompt in your language.');
        } finally {
            runtime.handling.delete(messageId);
            await saveChatConditional();
        }
        if (rerender) updateMessageBlock(messageId, message);
        else runtime.pendingRerender.add(messageId);
        decorateMessage(messageId);
        return;
    }

    if (runtime.pendingRerender.has(messageId)) {
        runtime.pendingRerender.delete(messageId);
        if (rerender) updateMessageBlock(messageId, message);
        return;
    }

    // Direct edit of the canonical EN (message without a display translation,
    // or edited through other means): re-translate EN -> user language.
    if (hash(message.mes) !== message.extra.translation.mesHash) {
        runtime.handling.add(messageId);
        try {
            const translated = await service.translate(message.mes, { direction: 'en->user' });
            message.extra ??= {};
            message.extra.display_text = translated;
            message.extra.translation = makeProvenance('en->user', message.mes, translated);
            delete message.extra.translation_failed;
        } catch (error) {
            console.warn('[Translation Layer] edit re-translation failed', error);
        } finally {
            runtime.handling.delete(messageId);
            await saveChatConditional();
            if (rerender) updateMessageBlock(messageId, message);
        }
        decorateMessage(messageId);
    }
}

// ---- Per-message buttons ----

function onViewClick() {
    const messageId = Number($(this).closest('.mes').attr('mesid'));
    const message = getMessage(messageId);
    if (!message?.extra?.display_text) return;
    if (runtime.viewingOriginal.has(messageId)) {
        runtime.viewingOriginal.delete(messageId);
        updateMessageBlock(messageId, message);
    } else {
        runtime.viewingOriginal.add(messageId);
        // display_text: undefined makes updateMessageBlock render the canonical `mes`
        updateMessageBlock(messageId, { ...message, extra: { ...message.extra, display_text: undefined } });
    }
}

async function onRetryClick() {
    const messageId = Number($(this).closest('.mes').attr('mesid'));
    if (!isConfigured()) return;
    const message = getMessage(messageId);
    if (!message || message.is_system) return;

    const provenance = message.extra?.translation;
    const failed = !provenance || message.extra.translation_failed;
    const direction = failed ? (message.is_user ? 'user->en' : 'en->user') : provenance.direction;
    const source = direction === 'user->en' ? (message.extra?.display_text ?? message.mes) : message.mes;
    if (!source) return;

    setChip(messageId, true);
    try {
        const result = await service.translate(source, { direction });
        message.extra ??= {};
        if (direction === 'user->en') {
            message.extra.display_text = source;
            message.mes = result;
        } else {
            message.extra.display_text = result;
        }
        message.extra.translation = makeProvenance(direction, message.mes, message.extra.display_text);
        delete message.extra.translation_failed;
    } catch (error) {
        console.warn('[Translation Layer] re-translation failed', error);
        message.extra ??= {};
        message.extra.translation_failed = true;
        toastr.warning('Translation Layer: re-translation failed.');
    } finally {
        setChip(messageId, false);
        await saveChatConditional();
        updateMessageBlock(messageId, message);
        decorateMessage(messageId);
    }
}

// ---- Stream masking (FR-5) ----

function onGenerationStarted(type, options) {
    const visibleGeneration = MASKED_GENERATION_TYPES.includes(type) && !options?.quiet_prompt;
    maskStream(isConfigured() && !settings.showOriginalDuringStream && visibleGeneration);
}

function onChatChanged() {
    runtime.viewingOriginal.clear();
    runtime.editBaseline.clear();
    runtime.pendingRerender.clear();
    maskStream(false);
    setTimeout(decorateAll, 300);
}

// ---- Settings UI ----

function updateWarning() {
    const $warning = $('#st-translation-layer-warning');
    $warning.text(
        settings.enabled && !(settings.baseUrl && settings.model)
            ? 'Translator not configured — new messages will not be translated.'
            : '',
    );
}

function bindSettingsUi() {
    const $language = $('#st-translation-layer-language');
    for (const [value, label] of LANGUAGES) {
        $language.append($('<option>', { value, text: label }));
    }

    $('#st-translation-layer-enabled').prop('checked', settings.enabled);
    $('#st-translation-layer-base-url').val(settings.baseUrl);
    $('#st-translation-layer-api-key').val(settings.apiKey);
    $('#st-translation-layer-model').val(settings.model);
    $language.val(settings.language);
    $('#st-translation-layer-language-other').toggleClass('st-tl-hidden', settings.language !== '_other');
    $('#st-translation-layer-reasoning').prop('checked', settings.translateReasoning);
    $('#st-translation-layer-stream').prop('checked', settings.showOriginalDuringStream);
    $('#st-translation-layer-via-st').prop('checked', settings.viaSt);
    updateWarning();

    $('#st-translation-layer-enabled').on('change', function () {
        settings.enabled = Boolean($(this).prop('checked'));
        updateWarning();
        saveSettingsDebounced();
    });
    $('#st-translation-layer-base-url').on('input', function () {
        settings.baseUrl = String($(this).val()).trim();
        updateWarning();
        saveSettingsDebounced();
    });
    $('#st-translation-layer-api-key').on('input', function () {
        settings.apiKey = String($(this).val());
        saveSettingsDebounced();
    });
    $('#st-translation-layer-model').on('input', function () {
        settings.model = String($(this).val()).trim();
        updateWarning();
        saveSettingsDebounced();
    });
    $language.on('change', function () {
        settings.language = String($(this).val());
        $('#st-translation-layer-language-other').toggleClass('st-tl-hidden', settings.language !== '_other');
        saveSettingsDebounced();
    });
    $('#st-translation-layer-language-other').on('input', function () {
        settings.languageOther = String($(this).val());
        saveSettingsDebounced();
    });
    $('#st-translation-layer-reasoning').on('change', function () {
        settings.translateReasoning = Boolean($(this).prop('checked'));
        saveSettingsDebounced();
    });
    $('#st-translation-layer-stream').on('change', function () {
        settings.showOriginalDuringStream = Boolean($(this).prop('checked'));
        saveSettingsDebounced();
    });
    $('#st-translation-layer-via-st').on('change', function () {
        settings.viaSt = Boolean($(this).prop('checked'));
        saveSettingsDebounced();
    });

    $('#st-translation-layer-test').on('click', async function () {
        const $result = $('#st-translation-layer-test-result');
        $result.text('…');
        const result = await service.testConnection();
        if (result.ok) {
            $result.text(`✓ OK (${result.latencyMs} ms)`).css('color', 'var(--green, green)');
        } else {
            $result.text(`✗ ${result.error}${result.cause ? ` — ${result.cause}` : ''}`).css('color', 'var(--fullRed, red)');
        }
    });
}

async function renderSettings() {
    // Third-party templates live under the "third-party/" route segment; without
    // the prefix the fetch 404s and kills the rest of the boot sequence.
    const html = await renderExtensionTemplateAsync(`third-party/${EXTENSION_NAME}`, 'settings');
    $('#extensions_settings2').append(html);
    bindSettingsUi();
}

// ---- Boot ----

jQuery(async () => {
    // extension_settings is already populated by the app before extension
    // modules load; never call loadExtensionSettings() from an extension — it
    // is the app-wide settings loader and re-enters the extension discovery.
    try {
        await renderSettings();
    } catch (error) {
        console.error('[Translation Layer] settings UI failed to render; pipeline still active', error);
    }

    eventSource.on(event_types.MESSAGE_SENT, (messageId) => onMessageSent(Number(messageId)));
    eventSource.on(event_types.MESSAGE_RECEIVED, (messageId) => onMessageReceived(Number(messageId)));
    eventSource.on(event_types.MESSAGE_EDITED, (messageId) => handleEdit(Number(messageId), { rerender: false }));
    eventSource.on(event_types.MESSAGE_UPDATED, (messageId) => handleEdit(Number(messageId), { rerender: true }));
    eventSource.on(event_types.GENERATION_STARTED, onGenerationStarted);
    eventSource.on(event_types.GENERATION_STOPPED, () => maskStream(false));
    eventSource.on(event_types.GENERATION_ENDED, () => maskStream(false));
    eventSource.on(event_types.USER_MESSAGE_RENDERED, (messageId) => decorateMessage(Number(messageId)));
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => decorateMessage(Number(messageId)));
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);

    $(document).on('click', '.mes_edit', onEditClick);
    $(document).on('click', '.st-tl-view', onViewClick);
    $(document).on('click', '.st-tl-retry', onRetryClick);
});
