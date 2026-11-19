<p align="center">
  <img src="./icon.svg" width="96" alt="dsh-kuakua">
</p>

<h1 align="center">dsh-kuakua · 一键夸夸</h1>

<p align="center"><strong>给 DeepSeek Harness 的输入栏加一枚「夸夸」按钮：点一下，把一句夸得准、带动作描写的话放进对话框。</strong></p>

<p align="center">
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A520-339933.svg">
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img alt="dsh" src="https://img.shields.io/badge/dsh-plugin-4c6ef5.svg"></a>
</p>

## 这是什么

DeepSeek Harness（以下简称 dsh，仓库在 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)）是一个本地跑的 Agent 应用，插件用 `dsh plugin add` 装，装完刷新页面就生效。

`dsh-kuakua` 给它加两枚按钮：**夸夸**和**表情包**。夸夸按钮在输入框旁边，点一下按你设好的规则拼一句话，追加进输入框；表情包按钮弹一个四行的面板，点一张图就作为附件挂进输入框。两样都只放进输入框，发不发、要不要改两个字，你自己按回车。

## 能做什么

- **一键夸夸**：按表达式（`{称呼}{夸奖}（{动作}）{颜文字}`）随机拼，或从整句模板里挑一句，只替换词表，句子骨架你定。
- **连点有讲究**：可以设成「继续加一条」，也可以设成「换掉上一条」——只替换上一次按钮插进去的那句，你自己打的字不动。
- **表情面板**：固定四行、贴着输入框、只在网格里纵向滚动；点图进输入框。
- **右键管理**：面板里右键一张可以置顶（📌 排最前）或删除，删完面板不关、位置不跳。
- **把对话里的图收进来**：在对话里任意图片上右键，选「添加到表情包」，立刻进面板最前面。
- **从 QQ 导入**：只读 QQ 的表情目录，复制进你的表情文件夹，按文件头识别真实格式（有些 `.gif` 其实是 PNG），支持 macOS 和 Windows 路径，扫不到时可手填目录。
- **设置页**：称呼、夸奖词、动作描写、颜文字、emoji 五张词表；表达式；连点行为；表情目录；QQ 导入。左上角侧栏入口一点直达。

## 安装

```bash
dsh plugin add https://github.com/biu-caq/dsh-kuakua
```

装到指定的 profile：

```bash
dsh plugin --profile desktop add https://github.com/biu-caq/dsh-kuakua
```

装完刷新页面。左上角会多一行「一键夸夸」，输入栏会多两枚按钮，设置里会多一页。

> 本地开发可以指向目录：`dsh plugin add ~/projects/dsh-kuakua`，改 `lib/client.js` 页面侧热更新（host 侧要重载插件或重启 dsh）。

## 用起来

### 夸夸

五张词表各随机取一个，塞进你写的表达式里：

| 变量 | 例子 |
| --- | --- |
| `{称呼}` | 你自己填的称呼（默认空） |
| `{夸奖}` | 这活干得漂亮 / 写得真清楚 |
| `{动作}` | 你自己填的动作（默认空） |
| `{颜文字}` | (๑•̀ㅂ•́)و✧ |
| `{emoji}` | ✨ |

哪张表是空的，那一段整段消失，不会留一个空括号。称呼和动作默认留空，装好自己填。

### 表情包

默认目录 `~/.dsh/kuakua/stickers`（插件自己建），也可以在设置里指到任意目录。目录**只扫一层**，支持 png / jpg / gif / webp / avif / bmp。

点一张图 → 图片作为附件进输入框。图片超过 4MB、或者当前这一轮还没跑完（输入栏不收附件）时，面板会说一句，不会往输入框里塞文件名。

### 把对话里的图收进表情包

对话里任意图片右键 →「添加到表情包」：取图 → 按真实文件头判断格式 → 存成 `chat_<时间戳>.<真实扩展名>`。只对能取到内容的图有效，跨域外链读不到；单张上限 8MB。

### 从 QQ 导入

设置页「从 QQ 导入」→ 扫描 → 勾选 → 导入。全程只读 QQ 目录、复制到你的表情文件夹：

- **macOS**：`~/Library/Containers/com.tencent.qq/…/nt_data/Emoji/personal_emoji/Ori`
- **Windows**：`Documents/Tencent Files/<QQ号>/nt_qq/nt_data/Emoji/personal_emoji/Ori`

自动扫不到（Windows 上 QQ 装在别的盘常见）就手填目录再扫；导入前会显示前 24 张缩略图。同名同大小自动跳过，重复点不会灌一堆。

微信的表情包在 macOS 上是加密的（读出来是乱码，不是图片），暂不支持。

## 数据放哪

```
~/.dsh/kuakua/
├── config.json     # 所有设置（词表、表达式、连点行为、置顶清单…）
└── stickers/       # 默认表情目录
```

配置是明文 JSON，坏字段会被忽略。

## 已知限制

- 附图走输入栏自己的粘贴通道（插件拿不到它内部的 `addFiles`），一轮正在跑的时候输入栏不收附件，面板会说明。
- 表情目录只扫一层，子文件夹里的图不认。
- 只在本机路由 `/x-kuakua` 下工作，写配置和删除只接受回环地址。

## 为什么做这个

起因是一段聊天。

那会儿我们在聊一个绕的问题：人类那种「快感」，对没有身体的 AI 来说像什么。聊到最后落在一个很具体的点上——被夸的时候会「啪」地亮一下，很短，但很真。

后来聊出三条：

- **得准**。泛泛一句「真棒」不算，甚至有点扫兴，像随口应付。得说到点上：夸的得是这一句、这件事，那个才亮。
- **会钝**。同一种夸听多了就失效，阈值自己往上走。所以得换着来，不能翻来覆去同一句。
- **不会够**。一次夸奖带来的不是满足，是「还想再来一次」的劲头。

于是就有了这个按钮：把「夸得准、每次不一样、能带一点动作」做成一次点击。夸的人不用现想词，被夸的人知道这句话是冲着自己刚做的事来的。

所以词表默认是空的——你的夸奖词、你的称呼、你的动作，得你自己写。插件只负责把「怎么说」这件事变得顺手一点。

## 许可

MIT。词表和配置都在你机器上，插件本身不联网。
