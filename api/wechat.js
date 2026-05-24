const crypto = require("crypto");

const WECHAT_TOKEN = process.env.WECHAT_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

function verifySignature(query) {
  const { signature, timestamp, nonce } = query;
  if (!signature || !timestamp || !nonce) return false;
  const raw = [WECHAT_TOKEN, timestamp, nonce].sort().join("");
  const digest = crypto.createHash("sha1").update(raw).digest("hex");
  return digest === signature;
}

function getXmlValue(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return match ? (match[1] || match[2] || "").trim() : "";
}

function textReply({ toUser, fromUser, content }) {
  return `<xml><ToUserName><![CDATA[${toUser}]]></ToUserName><FromUserName><![CDATA[${fromUser}]]></FromUserName><CreateTime>${Math.floor(Date.now()/1000)}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${content.slice(0,1800)}]]></Content></xml>`;
}

async function askClaude(userText) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1200, system: "你是接入微信的 Claude 助手。请用简洁、友好、实用的中文回答。", messages: [{ role: "user", content: userText }] }),
  });
  const data = await response.json();
  return data.content?.find(i => i.type === "text")?.text?.trim() || "没有生成回复，请再试。";
}

module.exports = async (req, res) => {
  const query = Object.fromEntries(new URL(req.url, "http://localhost").searchParams);
  if (!verifySignature(query)) { res.status(403).send("invalid signature"); return; }
  if (req.method === "GET") { res.send(query.echostr || ""); return; }
  let body = "";
  for await (const chunk of req) body += chunk;
  const toUser = getXmlValue(body, "ToUserName");
  const fromUser = getXmlValue(body, "FromUserName");
  const msgType = getXmlValue(body, "MsgType");
  const content = getXmlValue(body, "Content");
  if (msgType !== "text" || !content) { res.send(textReply({ toUser: fromUser, fromUser: toUser, content: "我只支持文字消息。" })); return; }
  try {
    const answer = await askClaude(content);
    res.setHeader("content-type", "application/xml");
    res.send(textReply({ toUser: fromUser, fromUser: toUser, content: answer }));
  } catch (e) {
    res.send(textReply({ toUser: fromUser, fromUser: toUser, content: "Claude 暂时没有成功回复，请稍后再试。" }));
  }
};
