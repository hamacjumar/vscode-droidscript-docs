import pkg from "./package.json";

declare global {
    interface Obj<T> {
        [x:string]: T;
    }

    type DSConfig = {
        langs: Obj<string>;
        vers: string[];
        version: string;
        scopes: Obj<string>;
        regHide: string;
        regControl: string;
        tname: Obj<string>;
        tdesc: Obj<string>;
    }

    type DSExtConfig = {
        PORT: string;
        serverIP: string;
    }

    type PkgCmds = typeof pkg.contributes.commands;
    type CmdMap = {[x in PkgCmds[number]["command"]]: PkgCmds[number]["title"]}
}