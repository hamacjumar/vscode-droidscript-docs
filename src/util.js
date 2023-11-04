
const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const os = require("os");
const axios = require("axios");
const FormData = require("form-data");

/** @param {string} ip */
const isValidIP = ip => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip);
/** @param {string} ip */
const isValidIPWithPort = ip => /^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip);

module.exports = { resolvePath, loadJson, saveJson, uploadFile, getFileFilter, batchPromises, isValidIP, isValidIPWithPort };

/** @param {string} file */
function resolvePath(file) {
    const homePfx = "~/";
    if (file.startsWith(homePfx)) file = path.resolve(os.homedir(), file.replace(homePfx, ''));
    return path.resolve(__dirname, '..', file);
}

/** @param {string} file */
async function loadJson(file) {
    const filePath = resolvePath(file);
    if (fs.existsSync(filePath)) {
        const fileData = await fs.promises.readFile(filePath, 'utf8');
        return JSON.parse(fileData);
    }
    return {};
}

/** @type {(file:string, data:any) => Promise<void>} */
async function saveJson(file, data) {
    const filePath = resolvePath(file);
    const fileData = JSON.stringify(data, null, '  ');
    await fs.promises.writeFile(filePath, fileData, 'utf8');
}

/**
 * @param {string} serverIP
 * @param {string|NodeJS.ReadableStream|Blob} text
 * @param {string} folder
 * @param {string} file
 * @returns {Promise<{status:"ok"}>}
 */
async function uploadFile(serverIP, text, folder, file) {
    const url = `http://${serverIP}/upload`;
    const formData = new FormData();
    formData.append(folder, text, { filename: file });
    // @ts-ignore
    const response = await axios.post(url, formData, {
        headers: formData.getHeaders()
    });
    return response.data;
}

/** @param {vscode.Uri} uri */
function getFileFilter(uri)
{
    const curDoc = vscode.window.activeTextEditor?.document;
    curDoc?.save();
    if (!uri && curDoc?.uri) uri = curDoc.uri;
    const fp = uri.fsPath;
    const markupPath = path.normalize("Docs/files/markup/");
    if (!fp.includes(markupPath)) return;
    // lang/scope/member
    let s = fp.split(markupPath)[1];
    let lsm = s.split(path.sep);
    if (lsm.length !== 3) return;
    return { scope: lsm[1], name: lsm[2].substring(0, lsm[2].indexOf(".")) };
}

/** @type {<T>(data:T[], handler:(o:T, i:number, l:T[]) => Promise<any>, batchSize?:number) => Promise<void>} */
async function batchPromises(data, handler, batchSize = 10) {
    /** @type {Promise<[Promise<any>]>[]} */
    let promises = [], i = 0;
    while (i < data.length) {
        while (promises.length < batchSize && i < data.length) {
            let promise = handler(data[i], i++, data);
            promises.push(promise = promise.then(res => [promise]));
        }
        const p = await Promise.race(promises);
        promises.splice(promises.indexOf(p[0]), 1);
    }
}
