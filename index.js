import fs from "fs";
import path from "path";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FILE_KEY = process.env.FIGMA_FILE_KEY;
const OUTPUT_DIR = "./output";

const headers = { "X-Figma-Token": FIGMA_TOKEN };

async function fetchFile() {
  const res = await axios.get(`https://api.figma.com/v1/files/${FILE_KEY}`, {
    headers,
  });
  return res.data;
}

// 画像・テキストノードを収集
function collectNodes(node, results = [], skipText = false) {
  // IMAGEノードならここで登録して、子孫のTEXTはスキップ
  if (node.exportSettings && node.exportSettings.length > 0) {
    results.push({
      type: "IMAGE",
      name: node.name,
      id: node.id,
      box: node.absoluteBoundingBox,
    });
    // 子孫は処理しない（ここがポイント！）
    return results;
  }

  // TEXTノード（skipTextがfalseの時だけ）
  if (!skipText && node.type === "TEXT" && node.characters) {
    results.push({
      type: "TEXT",
      name: node.name,
      text: node.characters,
      box: node.absoluteBoundingBox,
    });
  }

  // 子要素を探索
  if (node.children) {
    node.children.forEach((child) => collectNodes(child, results, skipText));
  }

  return results;
}

// 画像URLを取得
async function fetchImages(nodeIds) {
  if (nodeIds.length === 0) return {};
  const url = `https://api.figma.com/v1/images/${FILE_KEY}?ids=${nodeIds.join(
    ","
  )}&format=png`;
  const res = await axios.get(url, { headers });
  return res.data.images;
}

// 画像を保存
async function downloadImage(url, filepath) {
  const res = await axios.get(url, { responseType: "arraybuffer" });
  fs.writeFileSync(filepath, res.data);
  console.log(`✅ ${filepath} を保存しました`);
}

function sanitize(text) {
  return text.replace(/\u2028|\u2029/g, "");
}

async function main() {
  const fileData = await fetchFile();
  fs.writeFileSync(
    "figma.json",
    JSON.stringify(fileData, null, 2).replace(/\u2028|\u2029/g, "")
  );

  // 最上部のページ
  const page = fileData.document.children[0];
  console.log(`📄 最上部ページ: ${page.name}`);

  const pageDir = path.join(OUTPUT_DIR, page.name.replace(/[^\w-]/g, "_"));
  fs.mkdirSync(pageDir, { recursive: true });

  for (const artboard of page.children || []) {
    const nodes = collectNodes(artboard);
    if (nodes.length === 0) continue;

    // y → x でソート
    nodes.sort((a, b) => {
      const ay = a.box?.y ?? 0;
      const by = b.box?.y ?? 0;
      if (ay !== by) return ay - by;
      const ax = a.box?.x ?? 0;
      const bx = b.box?.x ?? 0;
      return ax - bx;
    });

    // 画像ノードのURLを取得
    const imageNodes = nodes.filter((n) => n.type === "IMAGE");
    const images = await fetchImages(imageNodes.map((n) => n.id));

    const imgDir = path.join(pageDir, "images");
    fs.mkdirSync(imgDir, { recursive: true });

    let mdContent = `# ${artboard.name}\n\n`;

    for (const node of nodes) {
      if (node.type === "TEXT") {
        mdContent += sanitize(node.text) + "\n\n";
      } else if (node.type === "IMAGE") {
        const safeName = node.name.replace(/[^\w-]/g, "_");
        const filePath = path.join(imgDir, `${safeName}.png`);
        if (images[node.id]) await downloadImage(images[node.id], filePath);
        mdContent += `![${node.name}](./images/${safeName}.png)\n\n`;
      }
    }

    const mdFile = path.join(
      pageDir,
      `${artboard.name.replace(/[^\w-]/g, "_")}.md`
    );
    fs.writeFileSync(mdFile, mdContent, "utf8");
    console.log(`📝 ${mdFile} を生成しました`);
  }
}

main().catch((err) => console.error("❌ エラー:", err.message));
