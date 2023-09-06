const vscode = require("vscode");
const fs = require("fs");
const fsp = fs.promises;
const { exec, ChildProcess } = require("child_process");
const path = require("path");
const glob = require("glob");
const pkg = require("./package.json");

const cmdPrefix = "droidscript-docs.";
const titlePrefix = "DroidScript Docs: ";
// default displayed commands
const commands = ["generateDocs", "preview", "updatePages", "filter", "allCommands"];

/** @type {CmdMap} */
const cmdMap = Object.assign({}, ...pkg.contributes.commands.map(c =>
    ({ [c.command.replace(cmdPrefix, "")]: c.title.replace(titlePrefix, "") })
));

let folderPath = "";
let generateJSFilePath = "files/generate.js";
let jsdocParserFilePath = "files/jsdoc-parser.js";
let updatePagesFilePath = "files/updatePages.js";
let markdownGenFilePath = "files/markdown-generator.js";
let confPath = "files/conf.json";

/** @type {vscode.StatusBarItem} */
let generateBtn;
/** @type {vscode.WebviewPanel} */
let webViewPanel;

let languageFilter = "*", versionFilter = "*", scopeFilter = "*", nameFilter = "*";
let lastCommand = "", working = false;
let LANG = "en";

/** @type {DSConfig} */
let conf;
/** @type {Obj<string>} */
let tnames = {};

const chn = vscode.window.createOutputChannel("Docs Debug");

/** @param {vscode.ExtensionContext} context */
function activate(context) {
    if (!vscode.workspace.workspaceFolders) return;
    const cw = vscode.workspace.workspaceFolders[0];
    if (!cw || !cw.name) return;

    folderPath = cw.uri.fsPath;
    generateJSFilePath = path.join(folderPath, generateJSFilePath);
    jsdocParserFilePath = path.join(folderPath, jsdocParserFilePath);
    updatePagesFilePath = path.join(folderPath, updatePagesFilePath);
    markdownGenFilePath = path.join(folderPath, markdownGenFilePath);
    confPath = path.join(folderPath, confPath);

    if (!fs.existsSync(generateJSFilePath)) return;
    if (!fs.existsSync(jsdocParserFilePath)) return;
    if (!fs.existsSync(confPath)) return;

    fs.readFile(confPath, "utf8", async (err, data) => {
        let error = "";
        if (err) error = err.name + ": " + err.message;
        else try {
            conf = JSON.parse(data);
            Object.assign(tnames, conf.tname, conf.tdesc);
        }
        catch (e) { error = "Reading conf.json: " + e.message; }
        if (error) await vscode.window.showErrorMessage(error);
    });

    generateBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    generateBtn.command = cmdPrefix + "selectCommand";
    generateBtn.text = "$(tools) Generate Docs";
    generateBtn.tooltip = "Select Command";
    generateBtn.show();

    /** @type {(cmd:string, cb:()=>any) => void} */
    const subscribe = (cmd, cb) => {
        context.subscriptions.push(vscode.commands.registerCommand(cmdPrefix + cmd, (...args) => (lastCommand = cmd, cb(...args))));
    };

    subscribe("generateDocs", () => generate({ clear: true }));
    subscribe("clean", () => generate({ clean: true }));
    subscribe("update", () => generate({ update: true }));
    subscribe("updatePages", () => execFile(updatePagesFilePath));
    subscribe("markdownGen", () => execFile(markdownGenFilePath));
    subscribe("addVariant", addVariant);
    subscribe("selectCommand", selectCommand);
    subscribe("allCommands", selectCommand.bind(null, true));
    subscribe("filter", chooseFilter);
    subscribe("preview", openWithLiveServer);
    subscribe("generateFile", generateFile);

    // vscode.workspace.onDidSaveTextDocument(event => generateFile(event.uri));

    vscode.languages.registerCompletionItemProvider('javascript', { provideCompletionItems });
    vscode.languages.registerCompletionItemProvider('markdown', { provideCompletionItems });

    getAllMarkupFiles();
}

// This method is called when your extension is deactivated
function deactivate() {
    generateBtn.dispose();
    webViewPanel.dispose();
    vscode.commands.executeCommand('livePreview.end');
}

function getAllMarkupFiles() {
    const p = path.join(folderPath, "files", "markup", LANG);
    let fdrs = fs.readdirSync( p );
    fdrs = fdrs.filter(m => {
        let g = fs.statSync(path.join(p, m));
        return g.isDirectory();
    });
    /** @type {Array<String>} */
    const mkfls = [];
    fdrs.forEach(m =>  mkfls.push(...fs.readdirSync(path.join(p, m))));
    vscode.commands.executeCommand('setContext', 'droidscript-docs.markupfiles', mkfls);
}

const generateOptions = { clean: false, clear: false, update: false, add: "", value: "", gen: true };
/** @param {Partial<typeof generateOptions>} [options] */
async function generate(options = generateOptions) {
    options = Object.assign({}, generateOptions, options);

    working = true;
    generateBtn.text = "$(sync~spin) Docs";
    generateBtn.tooltip = "Task: " + cmdMap[lastCommand];

    chn.clear();
    chn.show();

    if ("generateDocs,update,".includes(lastCommand + ",")) {
        if (await execFile(jsdocParserFilePath)) return;
        if (nameFilter == "*") vscode.commands.executeCommand('livePreview.end');
    }

    let optionStr = "";
    const filters = [languageFilter, scopeFilter, nameFilter];
    const filter = filters.filter(f => f != "*").join(".");
    if (options.clean) optionStr += " -C";
    if (options.clear) optionStr += " -c";
    if (!options.gen) optionStr += " -n";
    if (options.update) optionStr += " -u";
    if (options.add) optionStr += ` -a${options.add}="${options.value}"`;
    if (versionFilter != "*") optionStr += ` -v=${versionFilter}`;

    await execFile(generateJSFilePath, optionStr + ' ' + filter);

    working = false;
    generateBtn.text = "$(check) Docs: Done";
    if ("generateDocs,update,".includes(lastCommand + ",")) openWithLiveServer();
    updateTooltip();
}

/** @type {(file:string, args?:string) => Promise<number>} */
async function execFile(file, args = "") {
    // Execute the Docs/files/jsdoc-parser.js file
    chn.appendLine(`$ node ${file} ${args}`);
    try { return await processHandler(exec(`node ${file} ${args}`)); }
    catch (error) {
        await vscode.window.showErrorMessage(`Error: ${error.message || error}`);
        updateTooltip();
        return -1;
    }
}

/** @type {(cp:ChildProcess) => Promise<number>} */
function processHandler(cp) {
    cp.stdout?.on("data", data => chn.append(data.replace(/\x1b\[[0-9;]*[a-z]/gi, '')));
    cp.stderr?.on("data", data => chn.append(data.replace(/\x1b\[[0-9;]*[a-z]/gi, '')));
    let error = false;
    return new Promise((res, rej) => {
        cp.on("error", e => (error = true, chn.append("$ Error: " + e), rej(e)));
        cp.on("exit", (code, sig) => (chn.append(`$ Exit Code: ${code}` + (sig ? ` (${sig})` : '')), error || res(code || 0)));
    });
}

function updateTooltip() {
    const filter = `language: ${languageFilter}\nversion: ${versionFilter}\nscope: ${scopeFilter}\nname: ${nameFilter}`;
    generateBtn.tooltip = `Generate Filter\n${filter}`;
}

async function addVariant() {
    const ph = { Language: "en (English)", Version: "v257", Scope: "app (Reference)" };
    /** @ts-ignore @type {keyof typeof ph | undefined} */
    const variant = await vscode.window.showQuickPick(Object.keys(ph), { title: "Pick Variant" });
    if (!variant) return;

    /** @param {string} value */
    const validateInput = (value) => {
        const m = value.match(/^(\w*)(\s+\(?(.*)\)?)?$/);
        if (!m) return "Invalid Input";
        if (variant == "Language") {
            if (!m[1] || !/^[a-z][a-z]$/.test(m[1])) return "Language code must have 2 lower case letters";
            if (!m[3] || !/^\w{4,}$/.test(m[3])) return "Missing name after language code";
        }
        else if (variant == "Version") {
            // supports alpha, beta and patch versions, although noone might ever use those
            if (!m[1] || !/^v\d{3}([ab]\d(_p\d)?)?$/.test(m[1])) return "Version must start with a 'v' followed by 1-3 digits";
        }
        else if (variant == "Scope") {
            if (!m[1] || !/^[a-z][a-z0-9]{2,}$/i.test(m[1])) return "Scope namespace must have at least 3 digits";
            if (!m[3] || !/^.{4,}$/.test(m[3])) return "Missing title after scope namespace";
        }
        else return "How did you get in here?!";

        return undefined;
    }
    let value = await vscode.window.showInputBox({ title: "Enter " + variant, value: ph[variant], validateInput });
    if (!value) return;

    value = value?.replace(/[\s()]+/g, " ").replace(" ", "=");
    generate({ add: variant[0].toLowerCase(), value, gen: false });
}

async function chooseFilter() {
    const items = ["Language", "Version", "Scope", "Name"];
    /** @type {typeof items[number] | undefined} */
    const type = await vscode.window.showQuickPick(items, { title: "Pick Filter Type" });

    if (type == "Language") selectFilter(conf.langs, "Pick Language", languageFilter).then(s => s && (languageFilter = s));
    else if (type == "Version") selectFilter(conf.vers, "Pick Version", versionFilter).then(s => s && (versionFilter = s));
    else if (type == "Scope") selectFilter(conf.scopes, "Pick Scope", scopeFilter).then(s => s && (scopeFilter = s));
    else if (type == "Name") enterNameFilter();
    else if (type) await vscode.window.showWarningMessage("This is not okay, youre warned!");
}

/** @type {(list:string[]|Obj<string>, title:string, dflt?:string) => Promise<string | undefined>} */
async function selectFilter(list, title, dflt = "*") {
    const items = Object.values(list);
    if (!Array.isArray(list)) Object.keys(list).forEach((k, i) => items[i] = `${k} (${items[i]})`)
    items.push("* (all)");

    let placeHolder = items.find(s => s.includes(dflt)) || "all (*)";
    const res = await vscode.window.showQuickPick(items, { title, placeHolder });
    setTimeout(updateTooltip, 100);
    return res && res.split(' ')[0];
}

async function selectCommand(all = false) {
    const items = !all ? commands : Object.keys(cmdMap).filter(c => !"selectCommand,allCommands".includes(c));
    const title = await vscode.window.showQuickPick(items.map(c => cmdMap[c]), {
        title: "Select Command", placeHolder: "Generate"
    });
    const cmd = pkg.contributes.commands.find(c => c.title == titlePrefix + title);
    if (!cmd) return;
    await vscode.commands.executeCommand(cmd.command);
}

async function enterNameFilter() {
    const pattern = await vscode.window.showInputBox({
        title: "Enter Pattern", placeHolder: "Create*"
    });
    if (!pattern) return;

    try {
        nameFilter = RegExp(pattern).source;
        updateTooltip();
    }
    catch (e) {
        await vscode.window.showErrorMessage("Invalid RegExp Pattern: " + pattern);
    }
}

function langDir(l = languageFilter) { return l == "*" || l == "en" ? "docs" : "docs-" + l; }

/** @type {(lang:string, ver:string, scope:string, name:string) => string} */
function getServerPath(lang, ver, scope, name) {
    const subPath = ["out"];
    const langs = Object.keys(conf.langs);
    subPath.push(langDir(lang == "*" ? langs[0] : lang));
    subPath.push(ver == "*" ? conf.vers[0] : ver);

    if (name == "*")
        subPath.push(scope == "*" ? "Docs.htm" : conf.scopes[scope].replace(/\s/g, "") + ".htm");
    else {
        const globPath = path.join(folderPath, ...subPath, scope, '*' + name.replace(/\.\*/g, "*") + '*');
        const files = glob.sync(globPath, { windowsPathsNoEscape: true });
        const scopeName = path.basename(path.dirname(files[0] || "*"));
        if (files.length == 1) subPath.push(scopeName, path.basename(files[0]))
        else subPath.push("Docs.htm");
    }
    return path.join(folderPath, ...subPath);
}

async function openWithLiveServer() {
    const docsPath = getServerPath(languageFilter, versionFilter, scopeFilter, nameFilter);
    if (!fs.existsSync(docsPath)) return;
    const fileUri = vscode.Uri.file(docsPath);
    await vscode.commands.executeCommand('livePreview.start.preview.atFile', fileUri);
}

async function generateFile( uri ) {
    const fp = uri.fsPath;
    if( !fp.includes("Docs/files/markup/") ) return;
    // lang/scope/member
    let s = fp.split("Docs/files/markup/")[1];
    let lsm = s.split("/");
    if(lsm.length !== 3) return;
    scopeFilter = lsm[1];
    nameFilter = lsm[2].substring(0, lsm[2].indexOf("."));
    await execFile(jsdocParserFilePath, "-p="+scopeFilter+"."+nameFilter);
    nameFilter += "*";
    generate({clear: true});
}

/** @type {vscode.CompletionItemProvider["provideCompletionItems"]} */
function provideCompletionItems(doc, pos, token, context) {
    const ln = pos.line;
    const cd = doc.lineAt(ln).text;
    const area = cd.slice(Math.max(pos.character - 12, 0), pos.character);

    if (!cd.includes("@param") && !cd.includes("@return") && !area.match(/\w+(:|\|\|)\w*/)) return;

    const completionItems = Object.keys(tnames).map(a => {
        const item = new vscode.CompletionItem(a, vscode.CompletionItemKind.Property);
        let b = a.split(/\\?_/)[0];
        item.detail = b ? tnames[b] + ": " + tnames[a] : tnames[a];
        return item;
    });

    return completionItems;
}

module.exports = {
    activate,
    deactivate
}
