# 素材来源与复现

本版运行时所有三维角色、设备、食材、包装、界面图标和动作均为本项目重新创作。没有采用候选第三方素材包，也没有把原作模型、贴图、骨骼或动画转换后重新署名。

| 内容 | 制作源 | 许可 / 边界 |
| --- | --- | --- |
| 31 个三维资产 | `scripts/make-original-assets.mjs`，通过 Three.js 标准几何生成、按材质合并，导出 GLB | 原创几何，按项目 LICENSE；逐项尺寸、SHA-256、语义、握持点和动作名在 `public/assets/original/manifest.json` |
| 三名角色动作 | `src/experience/actor-animation.ts`，原创刚体关节走路、冲刺、持物、切配、倒饮与确认姿态 | 不使用第三方骨骼、动画片段或模型专有命名 |
| 场景与包装 | `src/experience/scene3d.ts`、`decor.ts` | 原创设备布置、标识与街边细节；商标名称不因本清单获得授权 |
| 17 个餐品图标 | 同一原创建模脚本离线生成 SVG | 无运行时 GPU 像素读回，无外部图片请求 |
| 音乐 | `scripts/make-audio.py` 与 `public/audio/` | 复用本项目旧版原创 108 BPM 三声部曲目；不是原作配乐 |
| 音效 | `src/game/audio.ts` | Web Audio 合成提示与低噪声设备音 |
| Three.js / React | npm 锁定依赖 | MIT；[完整运行依赖许可](THIRD_PARTY_NOTICES.md) 随源包和生产包保留 |
| 场景设计参考 | 《胡闹厨房 2》的公开玩法与本地只读研究 | 借鉴公共食材、手工/自动加工、有限缓冲、空间分工等机制；没有分发原作内容包 |

复现：`npm run assets:generate`；校验：`npm run assets:check`。生成脚本不读取游戏原始文件、网络资源或原作导出目录。原创建模采用可复现参数；角色动作由游戏状态驱动，不能冒充动作捕捉。

`npm run build` 通过白名单只写出 `assets/original`、`audio`、`challenges` 与应用编译结果。干净发布源包也使用白名单导出，排除私用资源、历史 2D 制作图、原始接口响应、输出录像和凭据。Git 历史须从导出目录重新初始化，不能公开当前私用仓库历史。

2026-10-23：31 个模型通过 Khronos glTF Validator，0 错误、0 警告。资源内容哈希与清单一致。画面与性能的实际验证见 README。


## v0.2.1 公开展示素材

`public/media/` 与 `docs/media/` 使用本项目实际游戏画面裁切、排版。`scripts/make-promo.py` 生成 55 秒宣传片：真实录像片段按原速剪辑，原创音乐三声部单独混音，中文字幕；没有生成或伪造玩法画面。系统中文字体仅用于栅格化文字，不分发字体文件。字幕源为 `public/media/trailer.zh.vtt`。

展示首页只加载本地图片和按需播放的视频；没有分析脚本、广告、会员数据或 AI API。新增内容与项目原有 MIT 许可一致。
