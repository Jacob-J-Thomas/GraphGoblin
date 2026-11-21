"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.threadOptions = threadOptions;
exports.sanitizeConfig = sanitizeConfig;
exports.clientOptions = clientOptions;
const contracts_1 = require("@graphgoblin/contracts");
const effort_names_js_1 = require("./effort-names.js");
const isolation_js_1 = require("./isolation.js");
function threadOptions(settings) {
    const { options } = settings;
    return {
        model: settings.model,
        modelReasoningEffort: (0, effort_names_js_1.codexEffortName)(settings.model, settings.effort),
        sandboxMode: options.sandbox,
        approvalPolicy: options.approval,
        networkAccessEnabled: options.networkAccess ?? false,
        webSearchMode: options.webSearch ? 'live' : 'disabled',
        skipGitRepoCheck: true,
        ...(settings.workingDirectory ? { workingDirectory: settings.workingDirectory } : {}),
    };
}
function sanitizeConfig(value) {
    if (typeof value === 'string' || typeof value === 'boolean')
        return value;
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : undefined;
    if (Array.isArray(value)) {
        return value.map(sanitizeConfig).filter((v) => v !== undefined);
    }
    if (value && typeof value === 'object') {
        const out = (0, isolation_js_1.table)();
        for (const [key, child] of Object.entries(value)) {
            const clean = sanitizeConfig(child);
            if (key && clean !== undefined)
                out[key] = clean;
        }
        return out;
    }
    return undefined;
}
function clientOptions(options, codexBinary, env) {
    const unplain = (0, contracts_1.invalidCodexConfigKeyPath)(options.configOverrides);
    if (unplain !== undefined)
        throw (0, isolation_js_1.overrideRefusal)(unplain.join('.'));
    const overrides = sanitizeConfig(options.configOverrides ?? {});
    return {
        ...(codexBinary ? { codexPathOverride: codexBinary } : {}),
        ...(env ? { env } : {}),
        config: (0, isolation_js_1.layerConfig)((0, isolation_js_1.isolationDefaults)(), overrides),
    };
}
