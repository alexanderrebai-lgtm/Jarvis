import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

/** Passerelle limitée entre l'interface et Jarvis : seuls ces canaux existent. */
const SEND = ["page:open", "page:close", "audio:utterance", "audio:clap", "audio:speaking", "input:text", "jarvis:stop", "jarvis:listen", "jarvis:show", "jarvis:toggle", "gesture", "camera:frames", "securite:verdict", "senses:etat", "reglages:ouvrir", "jarvis:redemarrer"];
const RECEIVE = ["jarvis:state", "jarvis:message", "jarvis:partial", "jarvis:heard", "jarvis:panel", "jarvis:flags", "audio:play", "audio:stop", "camera:capture", "race:state", "page:data", "meteo:data", "perf:data", "projet:data", "securite:evenement", "audio:ring", "securite:verifier", "reveil:etat", "taches:data", "reglages:groupe"];
const INVOKE = ["page:data", "tapo:toggle", "securite:armer", "securite:mode", "projet:fichier", "diagnostic:run", "disposition:appliquer", "reveil:passer", "reglages:lire", "reglages:enregistrer", "reglages:action", "reglages:choisir"];

contextBridge.exposeInMainWorld("jarvis", {
  send: (channel: string, payload?: unknown) => {
    if (SEND.includes(channel)) ipcRenderer.send(channel, payload);
  },
  invoke: (channel: string, payload?: unknown) => (INVOKE.includes(channel) ? ipcRenderer.invoke(channel, payload) : Promise.reject(new Error("canal refusé"))),
  on: (channel: string, listener: (payload: unknown) => void) => {
    if (!RECEIVE.includes(channel)) return () => undefined;
    const wrapped = (_event: IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});
