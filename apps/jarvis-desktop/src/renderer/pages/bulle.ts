import { api, el } from "../common.js";
import { createReactor } from "../hud.js";

export function renderBubble(root: HTMLElement): void {
  document.body.classList.add("bulle");
  const bubble = el("div", "bubble");
  const reactor = createReactor(108);
  const body = el("div", "", '<div class="txt">Dis « Jarvis » quand tu veux.</div><form><input placeholder="Demande à Jarvis…"></form>');
  const open = el("button", "close", "⤢");
  open.style.cssText = "position:absolute;top:10px;right:14px;width:28px;height:28px";
  open.onclick = () => api.send("jarvis:show");
  bubble.append(reactor, body, open);
  root.append(bubble);
  const txt = body.querySelector(".txt")!;
  const input = body.querySelector("input")!;
  body.querySelector("form")!.addEventListener("submit", (e) => {
    e.preventDefault();
    if (input.value.trim()) api.send("input:text", input.value.trim());
    input.value = "";
  });
  api.on("jarvis:partial", (t: string) => (txt.textContent = t.slice(-200)));
  api.on("jarvis:message", ({ from, text }: { from: string; text: string }) => from === "jarvis" && (txt.textContent = text.replace(/^📻\s*/, "").slice(-200)));
}
