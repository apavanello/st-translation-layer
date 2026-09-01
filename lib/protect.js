// Content protection around translation: code blocks, inline code and URLs are
// masked with ⟦TLn⟧ placeholders and restored byte-for-byte afterwards (SDD-1 §5).

const PLACEHOLDER = (n) => `⟦TL${n}⟧`;

const PATTERNS = [
    /```[\s\S]*?```/g, // fenced code blocks
    /`[^`\n]+`/g, // inline code
    /https?:\/\/\S+/g, // URLs
];

export function protectSegments(text) {
    const segments = [];
    let masked = text;
    for (const pattern of PATTERNS) {
        masked = masked.replace(pattern, (match) => {
            const index = segments.length;
            segments.push(match);
            return PLACEHOLDER(index);
        });
    }
    return { masked, segments };
}

export function restoreSegments(translated, segments) {
    const warnings = [];
    let out = translated;
    for (let i = 0; i < segments.length; i++) {
        const placeholder = PLACEHOLDER(i);
        const re = new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        if (re.test(out)) {
            out = out.replace(re, () => segments[i]);
        } else {
            // Translator mangled the placeholder: re-attach the original segment
            // (trailing) rather than losing it silently.
            out += `\n${segments[i]}`;
            warnings.push(placeholder);
        }
    }
    return { text: out, warnings };
}
