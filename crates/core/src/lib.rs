//! Picarium core.
//!
//! 设计约束：
//! 1. 不依赖任何 UI 框架、不依赖 Tauri、不依赖 Windows API。
//! 2. 只认「文件」。库 = 一个目录，索引可重建。
//! 3. 原始字节只读不改，内容寻址（SHA-256）天然去重。

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, Result};
use chrono::Utc;
use pinyin::{ToPinyin, ToPinyinMulti};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use walkdir::WalkDir;

const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"];

/// 是否为受支持的图片后缀（大小写不敏感，不接受前导点）。
pub fn is_image_ext(ext: &str) -> bool {
    IMAGE_EXTS.contains(&ext.to_ascii_lowercase().as_str())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Asset {
    pub sha: String,
    pub ext: String,
    pub bytes: u64,
    pub width: u32,
    pub height: u32,
    /// 是否为动图（GIF / APNG / 动画 WebP）。决定点击时是复制文件还是位图。
    #[serde(default)]
    pub animated: bool,
    pub name: String,
    pub source: String,
    /// 原始来源标识（例如进程名 WeChat.exe），方便以后重新映射显示名
    #[serde(default)]
    pub source_ref: String,
    pub added_at: String,
    #[serde(default)]
    pub tags: Vec<String>,
    /// 全拼，例如「无语」→ wuyu。导入/改名时算好，搜索时不用再转
    #[serde(default)]
    pub py: String,
    /// 拼音首字母，例如「无语」→ wy
    #[serde(default)]
    pub py_abbr: String,
    /// 所属分组（一个表情可以属于多个包）
    #[serde(default)]
    pub groups: Vec<String>,
    /// 收藏
    #[serde(default)]
    pub starred: bool,
    /// 最近一次复制使用的时间
    #[serde(default)]
    pub used_at: String,
    /// 每个字的全部读音（含多音字），搜索时做动态规划匹配。
    /// 只在内存里，不落盘——打开库时重算，几毫秒的事。
    #[serde(skip)]
    pub readings: Arc<Vec<Vec<&'static str>>>,
    /// 绝对路径，运行时由库根目录重新计算，不信任索引里的旧值
    #[serde(default)]
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanStats {
    pub scanned: usize,
    pub added: usize,
    pub duplicated: usize,
    pub skipped: usize,
    pub errors: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrashItem {
    pub asset: Asset,
    pub deleted_at: String,
}

/// 从字节入库的结果。`added = false` 表示库里已有相同内容（按 sha 去重）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaImport {
    pub sha: String,
    pub added: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct LibraryStats {
    pub assets: usize,
    pub bytes: u64,
    pub root: String,
}

fn default_trash_days() -> u32 {
    7
}

#[derive(Debug, Serialize, Deserialize)]
struct IndexFile {
    version: u32,
    assets: Vec<Asset>,
    /// 上次查看「未分组」的时间；比它新的未分组条目算「新」
    #[serde(default)]
    seen_ungrouped_at: String,
    /// 分组登记表：允许存在「0 张」的空分组
    #[serde(default)]
    groups: Vec<String>,
    /// 标签登记表：允许存在「0 张」的空标签（标签管理里新建的）
    #[serde(default)]
    tags: Vec<String>,
    /// 手动排序：key（分组名 / __star__）→ sha 顺序
    #[serde(default)]
    orders: std::collections::BTreeMap<String, Vec<String>>,
    /// 分组顺序（用户拖拽调整）；不在表里的分组按名字排到后面
    #[serde(default)]
    group_order: Vec<String>,
    /// 分组封面：分组名 → 组内某张图的 sha
    #[serde(default)]
    group_covers: std::collections::BTreeMap<String, String>,
    /// 置顶分组（按置顶顺序）
    #[serde(default)]
    pinned_groups: Vec<String>,
    /// 回收站保留天数（到期自动清理）
    #[serde(default = "default_trash_days")]
    trash_days: u32,
}

pub struct Library {
    root: PathBuf,
    assets: Vec<Asset>,
    known_groups: Vec<String>,
    known_tags: Vec<String>,
    orders: std::collections::BTreeMap<String, Vec<String>>,
    seen: HashSet<String>,
    seen_ungrouped_at: String,
    group_order: Vec<String>,
    group_covers: std::collections::BTreeMap<String, String>,
    pinned_groups: Vec<String>,
    trash_days: u32,
}

impl Library {
    /// 打开（或初始化）一个库。根目录不存在时自动创建。
    pub fn open(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        fs::create_dir_all(root.join("blobs"))?;
        fs::create_dir_all(root.join("thumbs"))?;

        let index_path = root.join("index.json");
        let mut assets: Vec<Asset> = Vec::new();
        let mut seen_ungrouped_at = String::new();
        let mut known_groups: Vec<String> = Vec::new();
        let mut known_tags: Vec<String> = Vec::new();
        let mut orders: std::collections::BTreeMap<String, Vec<String>> =
            std::collections::BTreeMap::new();
        let mut group_order: Vec<String> = Vec::new();
        let mut group_covers: std::collections::BTreeMap<String, String> =
            std::collections::BTreeMap::new();
        let mut pinned_groups: Vec<String> = Vec::new();
        let mut trash_days: u32 = default_trash_days();

        if index_path.exists() {
            let txt = fs::read_to_string(&index_path)?;
            match serde_json::from_str::<IndexFile>(&txt) {
                Ok(f) if f.version == 1 => {
                    assets = f.assets;
                    seen_ungrouped_at = f.seen_ungrouped_at;
                    known_groups = f.groups;
                    known_tags = f.tags;
                    orders = f.orders;
                    group_order = f.group_order;
                    group_covers = f.group_covers;
                    pinned_groups = f.pinned_groups;
                    trash_days = f.trash_days.clamp(1, 365);
                }
                _ => {
                    // 索引坏了不要紧：备份一份，按 blob 目录重建（后续里程碑）
                    let _ = fs::copy(&index_path, root.join("index.corrupt.json"));
                }
            }
        }

        // 路径永远以库根目录为准，避免库被搬走后索引里的旧路径失效
        // 历史上可能出现同一 sha 多条（重新导入 + 恢复导致），这里合并修复
        let mut migrated = false;
        {
            let mut unique: Vec<Asset> = Vec::new();
            let mut seen_sha: std::collections::HashSet<String> = std::collections::HashSet::new();
            for a in assets.drain(..) {
                if seen_sha.insert(a.sha.clone()) {
                    unique.push(a);
                } else {
                    migrated = true;
                    if let Some(existing) = unique.iter_mut().find(|x| x.sha == a.sha) {
                        for g in a.groups {
                            if !existing.groups.contains(&g) {
                                existing.groups.push(g);
                            }
                        }
                        for t in a.tags {
                            if !existing.tags.contains(&t) {
                                existing.tags.push(t);
                            }
                        }
                        existing.starred = existing.starred || a.starred;
                        if a.used_at > existing.used_at {
                            existing.used_at = a.used_at;
                        }
                    }
                }
            }
            assets = unique;
        }

        for a in &mut assets {
            a.path = blob_path_for(&root, &a.sha, &a.ext)
                .to_string_lossy()
                .to_string();
            // 老索引没有拼音字段，打开时补算一次并回写
            if a.py.is_empty() {
                let (py, abbr) = pinyin_of(&a.name);
                a.py = py;
                a.py_abbr = abbr;
                migrated = true;
            }
            a.readings = Arc::new(readings_of(&a.name));
            // 历史遗留：把 __trash__ 之类的内部标识误当成分组名，清掉
            if a.groups.iter().any(|g| g.starts_with("__")) {
                a.groups.retain(|g| !g.starts_with("__"));
                migrated = true;
            }
            if !a.animated {
                let p = blob_path_for(&root, &a.sha, &a.ext);
                a.animated = looks_animated(&p, &a.ext);
            }
        }

        // 文件已经不在的记录（历史重复删除导致）直接清掉，免得列表里出现空卡片
        let before = assets.len();
        assets.retain(|a| Path::new(&a.path).exists());
        if assets.len() != before {
            eprintln!(
                "[library] 清理了 {} 条找不到文件的记录",
                before - assets.len()
            );
            migrated = true;
        }

        // 资产里出现的分组必须进登记表（老库没有 groups 字段）
        {
            let mut known: std::collections::BTreeSet<String> = known_groups.into_iter().collect();
            for a in &assets {
                for g in &a.groups {
                    known.insert(g.clone());
                }
            }
            known_groups = known.into_iter().collect();
        }

        // 标签登记表：老库没有 tags 字段，把资产里出现过的标签补进来；空标签保留
        {
            let before = known_tags.clone();
            let mut known: std::collections::BTreeSet<String> = known_tags
                .into_iter()
                .map(|t| t.trim().to_string())
                .filter(|t| !t.is_empty())
                .collect();
            for a in &assets {
                for t in &a.tags {
                    known.insert(t.clone());
                }
            }
            known_tags = known.into_iter().collect();
            if known_tags != before {
                migrated = true;
            }
        }

        // 分组顺序：老库没有顺序表时按名字排；表里缺的补到末尾
        {
            let known: std::collections::HashSet<String> = known_groups.iter().cloned().collect();
            let mut ordered: Vec<String> = Vec::new();
            for name in group_order.into_iter() {
                if known.contains(&name) && !ordered.contains(&name) {
                    ordered.push(name);
                }
            }
            for name in &known_groups {
                if !ordered.contains(name) {
                    ordered.push(name.clone());
                }
            }
            group_order = ordered;
        }
        // 封面只保留「图还在、而且确实在这个组里」的记录；收藏夹是虚拟分组，单独保留
        group_covers.retain(|group, sha| {
            if group == "__star__" {
                return assets.iter().any(|a| &a.sha == sha && a.starred);
            }
            known_groups.iter().any(|g| g == group)
                && assets
                    .iter()
                    .any(|a| &a.sha == sha && a.groups.iter().any(|g| g == group))
        });
        pinned_groups.retain(|g| known_groups.iter().any(|x| x == g));
        pinned_groups.dedup();

        let seen = assets.iter().map(|a| a.sha.clone()).collect();
        let lib = Self {
            root,
            assets,
            known_groups,
            known_tags,
            orders,
            seen,
            seen_ungrouped_at,
            group_order,
            group_covers,
            pinned_groups,
            trash_days,
        };
        if migrated {
            let _ = lib.save();
        }
        // 过期项不在这里删：core 不知道 deleteMode，也调不了系统回收站。
        // 桌面/安卓壳打开库后调用 `purge_expired_trash`，按设置处理。
        Ok(lib)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn assets(&self) -> &[Asset] {
        &self.assets
    }

    pub fn blob_path(&self, sha: &str, ext: &str) -> PathBuf {
        blob_path_for(&self.root, sha, ext)
    }

    pub fn ensure_thumb(&self, sha: &str, ext: &str) -> Result<PathBuf> {
        ensure_thumb(&self.root, sha, ext)
    }

    /// 递归扫描一个目录，把图片收进库。返回统计。
    pub fn scan_folder(&mut self, dir: &Path) -> Result<ScanStats> {
        let mut stats = ScanStats {
            scanned: 0,
            added: 0,
            duplicated: 0,
            skipped: 0,
            errors: 0,
        };

        if !dir.exists() {
            anyhow::bail!("目录不存在: {}", dir.display());
        }

        for entry in WalkDir::new(dir).follow_links(false).into_iter() {
            let entry = match entry {
                Ok(e) => e,
                Err(e) => {
                    stats.errors += 1;
                    eprintln!("[scan] walk error: {e}");
                    continue;
                }
            };
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            let ext = match path.extension().and_then(|e| e.to_str()) {
                Some(e) => e.to_ascii_lowercase(),
                None => {
                    stats.skipped += 1;
                    continue;
                }
            };
            if !IMAGE_EXTS.contains(&ext.as_str()) {
                stats.skipped += 1;
                continue;
            }
            stats.scanned += 1;
            match self.add_file(path, &ext) {
                Ok(true) => stats.added += 1,
                Ok(false) => stats.duplicated += 1,
                Err(e) => {
                    stats.errors += 1;
                    eprintln!("[scan] {}: {e:#}", path.display());
                }
            }
        }

        self.save()?;
        Ok(stats)
    }

    /// 从字节入库（剪贴板用）。width/height 由调用方提供，避免重复解码。
    pub fn import_image_bytes(
        &mut self,
        data: Vec<u8>,
        ext: &str,
        name: &str,
        source: &str,
        source_ref: &str,
        tags: Vec<String>,
        groups: Vec<String>,
        width: u32,
        height: u32,
    ) -> Result<bool> {
        let sha = hex(&Sha256::digest(&data));
        if self.seen.contains(&sha) {
            return Ok(false);
        }

        let dst = self.blob_path(&sha, ext);
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent)?;
        }
        let tmp = dst.with_extension(format!("{ext}.tmp"));
        fs::write(&tmp, &data)?;
        fs::rename(&tmp, &dst)?;

        let (py, py_abbr) = pinyin_of(name);
        self.assets.push(Asset {
            sha: sha.clone(),
            ext: ext.to_string(),
            bytes: data.len() as u64,
            width,
            height,
            animated: false,
            name: name.to_string(),
            source: source.to_string(),
            source_ref: source_ref.to_string(),
            added_at: Utc::now().to_rfc3339(),
            tags: clean_list(tags),
            py,
            py_abbr,
            groups: clean_list(groups),
            starred: false,
            used_at: String::new(),
            readings: Arc::new(readings_of(name)),
            path: dst.to_string_lossy().to_string(),
        });
        self.seen.insert(sha);
        self.save()?;
        Ok(true)
    }

    /// 从内存字节入库（浏览器桥、未来的分享入口）。
    ///
    /// 与 `import_image_bytes` 的区别：这里自动探测宽高和动图标记
    /// （GIF / APNG / 动画 WebP），不会再出现「GIF 被存成静态图」；
    /// 同时返回 sha，方便调用方去重提示。
    /// `ext` 必须是 [is_image_ext] 认可的后缀；`name` 会剥掉结尾的 `.<ext>`，
    /// 为空时用 `untitled`。
    pub fn import_media_bytes(
        &mut self,
        data: Vec<u8>,
        ext: &str,
        name: &str,
        source: &str,
        source_ref: &str,
        tags: Vec<String>,
        groups: Vec<String>,
    ) -> Result<MediaImport> {
        let ext = ext.trim().to_ascii_lowercase();
        if !IMAGE_EXTS.contains(&ext.as_str()) {
            anyhow::bail!("不支持的图片类型: {ext}");
        }
        if data.is_empty() {
            anyhow::bail!("图片内容为空");
        }

        let sha = hex(&Sha256::digest(&data));
        if self.seen.contains(&sha) {
            return Ok(MediaImport { sha, added: false });
        }

        let dst = self.blob_path(&sha, &ext);
        if !dst.exists() {
            if let Some(parent) = dst.parent() {
                fs::create_dir_all(parent)?;
            }
            // 先写临时文件再改名，避免半截文件被当成有效 blob
            let tmp = dst.with_extension(format!("{ext}.tmp"));
            fs::write(&tmp, &data)?;
            fs::rename(&tmp, &dst)?;
        }

        let (width, height) = image::image_dimensions(&dst).unwrap_or((0, 0));
        let animated = looks_animated(&dst, &ext);
        let name = media_name(name, &ext);
        let (py, py_abbr) = pinyin_of(&name);
        let tags = clean_list(tags);
        let groups = clean_list(groups);

        // 和 update() 一致：字节入库带的标签/分组要进登记表，
        // 否则侧栏和标签管理要等重开库才看得到。
        for t in &tags {
            if !self.known_tags.iter().any(|x| x == t) {
                self.known_tags.push(t.clone());
            }
        }
        for g in &groups {
            if !self.known_groups.iter().any(|x| x == g) {
                self.known_groups.push(g.clone());
            }
        }

        self.assets.push(Asset {
            sha: sha.clone(),
            ext: ext.to_string(),
            bytes: data.len() as u64,
            width,
            height,
            animated,
            name: name.clone(),
            source: source.to_string(),
            source_ref: source_ref.to_string(),
            added_at: Utc::now().to_rfc3339(),
            tags,
            py,
            py_abbr,
            groups,
            starred: false,
            used_at: String::new(),
            readings: Arc::new(readings_of(&name)),
            path: dst.to_string_lossy().to_string(),
        });
        self.seen.insert(sha.clone());
        self.save()?;
        Ok(MediaImport { sha, added: true })
    }

    /// 单文件入库（拖拽、选择器、剪贴板都走这里）。
    /// 返回新增文件的 sha；已存在则返回 None。
    pub fn import_file(&mut self, path: &Path) -> Result<Option<String>> {
        let ext = image_ext(path).ok_or_else(|| anyhow::anyhow!("不支持的文件类型: {}", path.display()))?;
        if !self.add_file(path, &ext)? {
            return Ok(None);
        }
        self.save()?;
        Ok(self.assets.last().map(|a| a.sha.clone()))
    }

    /// 返回 Ok(true) 表示新增，Ok(false) 表示已存在（去重）
    fn add_file(&mut self, path: &Path, ext: &str) -> Result<bool> {
        let data = fs::read(path).with_context(|| format!("读取失败 {}", path.display()))?;
        let sha = hex(&Sha256::digest(&data));

        if self.seen.contains(&sha) {
            return Ok(false);
        }

        let dst = self.blob_path(&sha, ext);
        if !dst.exists() {
            if let Some(parent) = dst.parent() {
                fs::create_dir_all(parent)?;
            }
            // 先写临时文件再改名，避免半截文件被当成有效 blob
            let tmp = dst.with_extension(format!("{ext}.tmp"));
            fs::write(&tmp, &data)?;
            fs::rename(&tmp, &dst)?;
        }

        let (width, height) = image::image_dimensions(path).unwrap_or((0, 0));
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("untitled")
            .to_string();

        let (py, py_abbr) = pinyin_of(&name);
        let animated = looks_animated(path, ext);

        self.assets.push(Asset {
            sha: sha.clone(),
            ext: ext.to_string(),
            bytes: data.len() as u64,
            width,
            height,
            animated,
            name: name.clone(),
            source: "folder".to_string(),
            source_ref: path.to_string_lossy().to_string(),
            added_at: Utc::now().to_rfc3339(),
            tags: Vec::new(),
            py,
            py_abbr,
            groups: Vec::new(),
            starred: false,
            used_at: String::new(),
            readings: Arc::new(readings_of(&name)),
            path: dst.to_string_lossy().to_string(),
        });
        self.seen.insert(sha);
        Ok(true)
    }

    /// 关键字搜索：中文 / 全拼 / 拼音首字母 / 标签 / 分组。
    /// `group = Some("")` 表示只看未分组；`None` 表示不按分组过滤。
    pub fn search(&self, q: &str, group: Option<&str>, limit: usize) -> Vec<Asset> {
        let q = q.trim().to_lowercase();
        let mut scored: Vec<(i32, &Asset)> = Vec::new();

        for a in &self.assets {
            if let Some(g) = group {
                if g.is_empty() {
                    if !a.groups.is_empty() {
                        continue;
                    }
                } else if !a.groups.iter().any(|x| x == g) {
                    continue;
                }
            }
            let score = if q.is_empty() { 0 } else { match_score(a, &q) };
            if q.is_empty() || score > 0 {
                scored.push((score, a));
            }
        }

        if q.is_empty() {
            scored.sort_by(|x, y| y.1.added_at.cmp(&x.1.added_at));
        } else {
            scored.sort_by(|x, y| y.0.cmp(&x.0).then(y.1.added_at.cmp(&x.1.added_at)));
        }

        scored
            .into_iter()
            .take(limit)
            .map(|(_, a)| a.clone())
            .collect()
    }

    /// 改名称 / 标签 / 分组。只动索引，不动 blob——文件名永远是内容哈希。
    pub fn update(
        &mut self,
        sha: &str,
        name: Option<String>,
        tags: Option<Vec<String>>,
        groups: Option<Vec<String>>,
    ) -> Result<()> {
        let asset = self
            .assets
            .iter_mut()
            .find(|a| a.sha == sha)
            .ok_or_else(|| anyhow::anyhow!("库里找不到这张图"))?;

        if let Some(n) = name {
            let n = n.trim();
            if !n.is_empty() && n != asset.name {
                asset.name = n.to_string();
                let (py, abbr) = pinyin_of(&asset.name);
                asset.py = py;
                asset.py_abbr = abbr;
                asset.readings = Arc::new(readings_of(&asset.name));
            }
        }
        if let Some(t) = tags {
            let t = clean_list(t);
            // 桌面编辑弹窗走这里：新打的标签必须立刻进登记表，
            // 否则本轮 tag_stats / 筛选面板看不到，要等重开库归一。
            for name in &t {
                if !self.known_tags.iter().any(|x| x == name) {
                    self.known_tags.push(name.clone());
                }
            }
            self.known_tags = clean_list(std::mem::take(&mut self.known_tags));
            asset.tags = t;
        }
        if let Some(g) = groups {
            asset.groups = clean_list(g);
        }
        self.save()
    }

    pub fn trash_path(&self) -> PathBuf {
        self.root.join("trash")
    }

    /// 回收站里「有文件、没元数据」的孤儿条目收养回来。
    ///
    /// 两种情况会留下孤儿：从 Windows 回收站还原（文件回到 trash/，但我们的
    /// index.json 早清空了），以及老版本先清元数据、送系统回收站失败的路径。
    /// 不收养的话界面永远显示 0 张，到期清理也永远看不到它们。
    fn adopt_orphans(&self, items: &mut Vec<TrashItem>) {
        let dir = self.trash_path();
        let Ok(rd) = fs::read_dir(&dir) else { return };
        let mut changed = false;
        for entry in rd.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let Some(ext) = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|s| s.to_ascii_lowercase())
            else {
                continue;
            };
            if !IMAGE_EXTS.contains(&ext.as_str()) {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            if !is_sha_like(stem) || items.iter().any(|i| i.asset.sha == stem) {
                continue;
            }

            let meta = entry.metadata().ok();
            let bytes = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let stamp = meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .map(|t| chrono::DateTime::<Utc>::from(t).to_rfc3339())
                .unwrap_or_else(|| Utc::now().to_rfc3339());
            let name = format!("未命名-{}", &stem[..stem.len().min(8)]);
            let (py, py_abbr) = pinyin_of(&name);
            items.push(TrashItem {
                asset: Asset {
                    sha: stem.to_string(),
                    ext,
                    bytes,
                    width: 0,
                    height: 0,
                    animated: false,
                    name: name.clone(),
                    source: String::new(),
                    source_ref: String::new(),
                    added_at: stamp.clone(),
                    tags: Vec::new(),
                    py,
                    py_abbr,
                    groups: Vec::new(),
                    starred: false,
                    used_at: String::new(),
                    readings: Arc::new(readings_of(&name)),
                    path: String::new(),
                },
                deleted_at: stamp,
            });
            changed = true;
        }
        if changed {
            // 写回元数据，下次启动就不用再扫；失败也不影响本次显示。
            let _ = self.write_trash(items);
        }
    }

    fn read_trash(&self) -> Vec<TrashItem> {
        let path = self.trash_path().join("index.json");
        let mut items: Vec<TrashItem> = fs::read_to_string(path)
            .ok()
            .and_then(|txt| serde_json::from_str::<Vec<TrashItem>>(&txt).ok())
            .unwrap_or_default();

        // 同一 sha 只保留最新的一条，避免"恢复两次"
        items.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
        let mut seen = std::collections::HashSet::new();
        items.retain(|i| seen.insert(i.asset.sha.clone()));
        self.adopt_orphans(&mut items);
        items.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
        items
    }

    fn write_trash(&self, items: &[TrashItem]) -> Result<()> {
        let dir = self.trash_path();
        fs::create_dir_all(&dir)?;
        let path = dir.join("index.json");
        let tmp = dir.join("index.json.tmp");
        fs::write(&tmp, serde_json::to_string_pretty(items)?)?;
        fs::rename(&tmp, &path)?;
        Ok(())
    }

    /// 回收站保留天数
    pub fn trash_days(&self) -> u32 {
        self.trash_days
    }

    /// 设置回收站保留天数（1–365 天）
    pub fn set_trash_days(&mut self, days: u32) -> Result<()> {
        self.trash_days = days.clamp(1, 365);
        self.save()
    }

    /// 删除回收站里超过保留天数的条目，返回清掉的数量。
    ///
    /// core 不自己删文件：`remove` 负责处理文件，返回是否已经处理掉
    /// （真删了、或送进了系统回收站）。只有返回 `true` 才移除元数据；
    /// 失败就留在回收站清单里，下一次启动再试。
    pub fn purge_expired_trash<F>(&self, mut remove: F) -> Result<usize>
    where
        F: FnMut(&Path) -> bool,
    {
        let items = self.read_trash();
        if items.is_empty() {
            return Ok(0);
        }
        let cutoff = Utc::now() - chrono::Duration::days(self.trash_days as i64);
        let mut kept = Vec::new();
        let mut removed = 0usize;
        for item in items {
            let expired = chrono::DateTime::parse_from_rfc3339(&item.deleted_at)
                .map(|t| t.with_timezone(&Utc) < cutoff)
                .unwrap_or(false);
            if expired {
                let path = self
                    .trash_path()
                    .join(format!("{}.{}", item.asset.sha, item.asset.ext));
                // 文件早就不在（用户手动删了）也算处理完；否则交给调用方，
                // 按 deleteMode 决定永久删还是送系统回收站。失败就留着，
                // 免得又变成孤儿文件、界面显示 0 张。
                let gone = if path.exists() { remove(&path) } else { true };
                if gone {
                    removed += 1;
                } else {
                    kept.push(item);
                }
            } else {
                kept.push(item);
            }
        }
        if removed > 0 {
            self.write_trash(&kept)?;
        }
        Ok(removed)
    }

    /// 回收站列表（新的在前）
    pub fn trash(&self) -> Vec<TrashItem> {
        let mut items = self.read_trash();
        items.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
        items
    }

    /// 回收站里搜索：名字 / 拼音 / 首字母，规则和主库一致
    pub fn search_trash(&self, q: &str) -> Vec<TrashItem> {
        let q = q.trim().to_lowercase();
        let mut items = self.trash();
        if q.is_empty() {
            return items;
        }
        items.retain(|item| {
            let mut a = item.asset.clone();
            if a.readings.is_empty() {
                a.readings = Arc::new(readings_of(&a.name));
            }
            match_score(&a, &q) > 0
        });
        items
    }

    /// 从回收站恢复
    pub fn restore(&mut self, sha: &str) -> Result<()> {
        let mut items = self.read_trash();
        let idx = items
            .iter()
            .position(|i| i.asset.sha == sha)
            .ok_or_else(|| anyhow::anyhow!("回收站里没有这张图"))?;
        let mut item = items.remove(idx);

        let src = self.trash_path().join(format!("{}.{}", item.asset.sha, item.asset.ext));
        let dst = blob_path_for(&self.root, &item.asset.sha, &item.asset.ext);

        // 关键：库里已经有同一张（删掉后又重新导入过）→ 不再插入第二条
        if self.seen.contains(&item.asset.sha) {
            if let Some(existing) = self.assets.iter_mut().find(|a| a.sha == item.asset.sha) {
                for g in &item.asset.groups {
                    if !existing.groups.contains(g) {
                        existing.groups.push(g.clone());
                    }
                }
                for t in &item.asset.tags {
                    if !existing.tags.contains(t) {
                        existing.tags.push(t.clone());
                    }
                }
                existing.starred = existing.starred || item.asset.starred;
            }
            let _ = fs::remove_file(&src);
            self.write_trash(&items)?;
            self.save()?;
            return Ok(());
        }
        if src.exists() {
            if let Some(parent) = dst.parent() {
                fs::create_dir_all(parent)?;
            }
            if fs::rename(&src, &dst).is_err() {
                fs::copy(&src, &dst)?;
                let _ = fs::remove_file(&src);
            }
        }

        item.asset.path = dst.to_string_lossy().to_string();
        item.asset.readings = Arc::new(readings_of(&item.asset.name));
        self.seen.insert(item.asset.sha.clone());
        self.assets.push(item.asset);

        self.write_trash(&items)?;
        self.save()
    }

    /// 彻底删除一条：把文件路径交出去，由调用方送进系统回收站
    pub fn delete_forever(&mut self, sha: &str) -> Result<Option<PathBuf>> {
        let mut items = self.read_trash();
        let mut removed = None;
        if let Some(idx) = items.iter().position(|i| i.asset.sha == sha) {
            let item = items.remove(idx);
            removed = Some(
                self.trash_path()
                    .join(format!("{}.{}", item.asset.sha, item.asset.ext)),
            );
        }
        self.write_trash(&items)?;
        Ok(removed)
    }

    /// 清空回收站：返回所有待删除文件，由调用方送进系统回收站
    pub fn purge_trash(&mut self) -> Result<Vec<PathBuf>> {
        let items = self.read_trash();
        let paths: Vec<PathBuf> = items
            .iter()
            .map(|item| {
                self.trash_path()
                    .join(format!("{}.{}", item.asset.sha, item.asset.ext))
            })
            .collect();
        self.write_trash(&[])?;
        Ok(paths)
    }

    /// 回收站里某一条对应的文件路径（不修改元数据）。
    pub fn trash_file_path(&self, sha: &str) -> Option<PathBuf> {
        self.trash()
            .into_iter()
            .find(|i| i.asset.sha == sha)
            .map(|i| {
                self.trash_path()
                    .join(format!("{}.{}", i.asset.sha, i.asset.ext))
            })
    }

    /// 从回收站元数据里移除指定条目（文件由调用方先处理完）。
    pub fn drop_trash_items(&mut self, shas: &[String]) -> Result<()> {
        if shas.is_empty() {
            return Ok(());
        }
        let mut items = self.read_trash();
        items.retain(|i| !shas.iter().any(|s| s == &i.asset.sha));
        self.write_trash(&items)
    }

    /// 批量收藏 / 取消收藏
    pub fn set_star(&mut self, shas: &[String], on: bool) -> Result<()> {
        for a in self.assets.iter_mut() {
            if shas.iter().any(|s| s == &a.sha) {
                a.starred = on;
            }
        }
        self.save()
    }

    /// 批量移出某个分组
    pub fn remove_from_group(&mut self, shas: &[String], group: &str) -> Result<()> {
        for a in self.assets.iter_mut() {
            if shas.iter().any(|s| s == &a.sha) {
                a.groups.retain(|g| g != group);
            }
        }
        self.save()
    }

    /// 批量去标签
    pub fn remove_tags(&mut self, shas: &[String], tags: &[String]) -> Result<()> {
        for a in self.assets.iter_mut() {
            if shas.iter().any(|s| s == &a.sha) {
                a.tags.retain(|t| !tags.iter().any(|x| x == t));
            }
        }
        self.save()
    }

    /// 批量加标签
    pub fn add_tags(&mut self, shas: &[String], tags: Vec<String>) -> Result<usize> {
        let tags = clean_list(tags);
        let mut n = 0;
        for a in self.assets.iter_mut() {
            if shas.iter().any(|s| s == &a.sha) {
                for t in &tags {
                    if !a.tags.contains(t) {
                        a.tags.push(t.clone());
                    }
                }
                n += 1;
            }
        }
        if n > 0 {
            for t in &tags {
                if !self.known_tags.iter().any(|x| x == t) {
                    self.known_tags.push(t.clone());
                }
            }
            self.known_tags = clean_list(std::mem::take(&mut self.known_tags));
        }
        self.save()?;
        Ok(n)
    }

    /// 新建一个空标签（管理页用）；同名返回 false
    pub fn create_tag(&mut self, name: &str) -> Result<bool> {
        let name = name.trim();
        if name.is_empty() {
            anyhow::bail!("标签名不能为空");
        }
        if self.known_tags.iter().any(|t| t == name) {
            return Ok(false);
        }
        self.known_tags.push(name.to_string());
        self.save()?;
        Ok(true)
    }

    /// 重命名标签；新名字已存在时等价于合并。返回受影响的图片数。
    pub fn rename_tag(&mut self, old: &str, new: &str) -> Result<usize> {
        let new = new.trim();
        if new.is_empty() {
            anyhow::bail!("标签名不能为空");
        }
        if old == new {
            return Ok(0);
        }
        self.known_tags.retain(|t| t != old);
        if !self.known_tags.iter().any(|t| t == new) {
            self.known_tags.push(new.to_string());
        }
        self.known_tags = clean_list(std::mem::take(&mut self.known_tags));

        let mut n = 0;
        for a in &mut self.assets {
            if a.tags.iter().any(|t| t == old) {
                a.tags.retain(|t| t != old);
                if !a.tags.iter().any(|t| t == new) {
                    a.tags.push(new.to_string());
                }
                n += 1;
            }
        }
        let mut items = self.read_trash();
        let mut changed = false;
        for it in &mut items {
            if it.asset.tags.iter().any(|t| t == old) {
                it.asset.tags.retain(|t| t != old);
                if !it.asset.tags.iter().any(|t| t == new) {
                    it.asset.tags.push(new.to_string());
                }
                changed = true;
            }
        }
        if changed {
            self.write_trash(&items)?;
        }
        self.save()?;
        Ok(n)
    }

    /// 合并标签：把 from 并入 to，from 从登记表和所有图片上移除
    pub fn merge_tags(&mut self, from: &str, to: &str) -> Result<usize> {
        let to = to.trim();
        if to.is_empty() {
            anyhow::bail!("标签名不能为空");
        }
        if from == to {
            return Ok(0);
        }
        self.known_tags.retain(|t| t != from);
        if !self.known_tags.iter().any(|t| t == to) {
            self.known_tags.push(to.to_string());
        }
        self.known_tags = clean_list(std::mem::take(&mut self.known_tags));

        let mut n = 0;
        for a in &mut self.assets {
            if a.tags.iter().any(|t| t == from) {
                a.tags.retain(|t| t != from);
                if !a.tags.iter().any(|t| t == to) {
                    a.tags.push(to.to_string());
                }
                n += 1;
            }
        }
        let mut items = self.read_trash();
        let mut changed = false;
        for it in &mut items {
            if it.asset.tags.iter().any(|t| t == from) {
                it.asset.tags.retain(|t| t != from);
                if !it.asset.tags.iter().any(|t| t == to) {
                    it.asset.tags.push(to.to_string());
                }
                changed = true;
            }
        }
        if changed {
            self.write_trash(&items)?;
        }
        self.save()?;
        Ok(n)
    }

    /// 彻底删除一个标签：登记表、在库图片、回收站里的引用一起清掉
    pub fn delete_tag(&mut self, name: &str) -> Result<usize> {
        let name = name.trim();
        if name.is_empty() {
            anyhow::bail!("标签名不能为空");
        }
        self.known_tags.retain(|t| t != name);
        let mut n = 0;
        for a in &mut self.assets {
            if a.tags.iter().any(|t| t == name) {
                a.tags.retain(|t| t != name);
                n += 1;
            }
        }
        let mut items = self.read_trash();
        let mut changed = false;
        for it in &mut items {
            if it.asset.tags.iter().any(|t| t == name) {
                it.asset.tags.retain(|t| t != name);
                changed = true;
            }
        }
        if changed {
            self.write_trash(&items)?;
        }
        self.save()?;
        Ok(n)
    }

    /// 整组替换某张图的标签（详情页保存用）；空列表表示清空
    pub fn set_asset_tags(&mut self, sha: &str, tags: Vec<String>) -> Result<()> {
        let tags = clean_list(tags);
        {
            let asset = self
                .assets
                .iter_mut()
                .find(|a| a.sha == sha)
                .ok_or_else(|| anyhow::anyhow!("图片不存在"))?;
            asset.tags = tags.clone();
        }
        for t in tags {
            if !self.known_tags.iter().any(|x| x == &t) {
                self.known_tags.push(t);
            }
        }
        self.known_tags = clean_list(std::mem::take(&mut self.known_tags));
        self.save()
    }

    /// 记一次使用（复制）
    pub fn touch_used(&mut self, sha: &str) -> Result<()> {
        if let Some(a) = self.assets.iter_mut().find(|a| a.sha == sha) {
            a.used_at = Utc::now().to_rfc3339();
            self.save()?;
        }
        Ok(())
    }

    pub fn starred(&self) -> Vec<Asset> {
        let mut out: Vec<Asset> = self.assets.iter().filter(|a| a.starred).cloned().collect();
        out.sort_by(|a, b| b.added_at.cmp(&a.added_at));
        out
    }

    pub fn starred_count(&self) -> usize {
        self.assets.iter().filter(|a| a.starred).count()
    }

    pub fn recent(&self, limit: usize) -> Vec<Asset> {
        let mut out: Vec<Asset> = self
            .assets
            .iter()
            .filter(|a| !a.used_at.is_empty())
            .cloned()
            .collect();
        out.sort_by(|a, b| b.used_at.cmp(&a.used_at));
        out.truncate(limit);
        out
    }

    pub fn recent_count(&self) -> usize {
        self.assets.iter().filter(|a| !a.used_at.is_empty()).count()
    }

    /// 分组名 + 数量，按数量倒序
    pub fn group_stats(&self) -> Vec<(String, usize)> {
        let mut map: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
        // 先登记空分组，保证 0 张的分组也能显示
        for g in &self.known_groups {
            map.entry(g.clone()).or_insert(0);
        }
        for a in &self.assets {
            for g in &a.groups {
                *map.entry(g.clone()).or_insert(0) += 1;
            }
        }
        let mut out: Vec<(String, usize)> = map.into_iter().collect();
        out.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        out
    }

    /// 未分组数量
    pub fn ungrouped_count(&self) -> usize {
        self.assets.iter().filter(|a| a.groups.is_empty()).count()
    }

    /// 未分组里「上次查看之后新增」的数量
    pub fn ungrouped_new(&self) -> usize {
        self.assets
            .iter()
            .filter(|a| a.groups.is_empty() && a.added_at > self.seen_ungrouped_at)
            .count()
    }

    /// 点开「未分组」时调用：把红点清零
    pub fn mark_ungrouped_seen(&mut self) -> Result<()> {
        self.seen_ungrouped_at = Utc::now().to_rfc3339();
        self.save()
    }

    /// 全部标签（按使用次数倒序），给多选控件用。
    /// 管理页新建的空标签也会保留在列表里（count = 0）。
    pub fn tag_stats(&self) -> Vec<(String, usize)> {
        let mut map: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
        for t in &self.known_tags {
            map.insert(t.clone(), 0);
        }
        for a in &self.assets {
            for t in &a.tags {
                *map.entry(t.clone()).or_insert(0) += 1;
            }
        }
        let mut out: Vec<(String, usize)> = map.into_iter().collect();
        out.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        out
    }

    /// 把若干张图加进一个分组（拖拽、批量操作都走这里）
    pub fn add_group(&mut self, shas: &[String], group: &str) -> Result<()> {
        let g = group.trim();
        if g.is_empty() {
            return Ok(());
        }
        validate_group_name(g)?;
        if !self.known_groups.iter().any(|x| x == g) {
            self.known_groups.push(g.to_string());
            self.group_order.push(g.to_string());
        }
        for a in self.assets.iter_mut() {
            if shas.iter().any(|s| s == &a.sha) && !a.groups.iter().any(|x| x == g) {
                a.groups.push(g.to_string());
            }
        }
        self.save()
    }

    /// 把若干张图移出所有分组
    pub fn clear_groups(&mut self, shas: &[String]) -> Result<()> {
        for a in self.assets.iter_mut() {
            if shas.iter().any(|s| s == &a.sha) {
                a.groups.clear();
            }
        }
        self.save()
    }

    /// 分组改名（空名字 = 解散分组）
    pub fn rename_group(&mut self, old: &str, new: &str) -> Result<usize> {
        let new = new.trim();
        if new.is_empty() {
            return self.remove_group(old, false);
        }
        validate_group_name(new)?;
        for g in self.known_groups.iter_mut() {
            if g == old {
                *g = new.to_string();
            }
        }
        self.known_groups = clean_list(std::mem::take(&mut self.known_groups));
        for g in self.group_order.iter_mut() {
            if g == old {
                *g = new.to_string();
            }
        }
        self.group_order = clean_list(std::mem::take(&mut self.group_order));
        if let Some(sha) = self.group_covers.remove(old) {
            self.group_covers.insert(new.to_string(), sha);
        }
        if let Some(order) = self.orders.remove(old) {
            self.orders.insert(new.to_string(), order);
        }
        for g in self.pinned_groups.iter_mut() {
            if g == old {
                *g = new.to_string();
            }
        }
        self.pinned_groups = clean_list(std::mem::take(&mut self.pinned_groups));
        let mut touched = 0;
        for a in &mut self.assets {
            let mut changed = false;
            for g in a.groups.iter_mut() {
                if g == old {
                    *g = new.to_string();
                    changed = true;
                }
            }
            if changed {
                a.groups = clean_list(std::mem::take(&mut a.groups));
                touched += 1;
            }
        }
        self.save()?;
        Ok(touched)
    }

    /// `delete_assets = false`：只把成员移出分组（解散分组）
    /// `delete_assets = true` ：连同组里的表情一起删（进 trash）
    /// 按 sha 查一张
    pub fn find(&self, sha: &str) -> Option<&Asset> {
        self.assets.iter().find(|a| a.sha == sha)
    }

    /// 按手动顺序重排；没排过的条目按原顺序追加在后面
    pub fn ordered(&self, key: &str, list: Vec<Asset>) -> Vec<Asset> {
        let Some(order) = self.orders.get(key) else {
            return list;
        };
        let rank: std::collections::HashMap<&str, usize> = order
            .iter()
            .enumerate()
            .map(|(i, sha)| (sha.as_str(), i))
            .collect();
        let mut out = list;
        out.sort_by_key(|a| rank.get(a.sha.as_str()).copied().unwrap_or(usize::MAX));
        out
    }

    /// 保存某个视图的排序
    pub fn set_order(&mut self, key: &str, shas: Vec<String>) -> Result<()> {
        if shas.is_empty() {
            self.orders.remove(key);
        } else {
            self.orders.insert(key.to_string(), shas);
        }
        self.save()
    }

    /// 分组顺序（用户拖拽过就是拖拽顺序，否则按名字）
    pub fn group_order(&self) -> &[String] {
        &self.group_order
    }

    /// 按给定顺序重排分组；没提到的分组按现有顺序补在后面
    pub fn set_group_order(&mut self, order: &[String]) -> Result<()> {
        let mut ordered: Vec<String> = Vec::new();
        for name in order {
            if self.known_groups.iter().any(|g| g == name) && !ordered.contains(name) {
                ordered.push(name.clone());
            }
        }
        for name in &self.known_groups {
            if !ordered.contains(name) {
                ordered.push(name.clone());
            }
        }
        self.known_groups = ordered.clone();
        self.group_order = ordered;
        self.save()
    }

    /// 分组封面（组内某张图的 sha）
    pub fn group_cover(&self, name: &str) -> Option<&str> {
        self.group_covers.get(name).map(|s| s.as_str())
    }

    pub fn set_group_cover(&mut self, name: &str, sha: Option<&str>) -> Result<()> {
        if !self.known_groups.iter().any(|g| g == name) {
            return Err(anyhow::anyhow!("分组不存在：{name}"));
        }
        match sha {
            None => {
                self.group_covers.remove(name);
            }
            Some(sha) => {
                let ok = self
                    .assets
                    .iter()
                    .any(|a| a.sha == sha && a.groups.iter().any(|g| g == name));
                if !ok {
                    return Err(anyhow::anyhow!("封面必须是这个分组里的图"));
                }
                self.group_covers.insert(name.to_string(), sha.to_string());
            }
        }
        self.save()
    }

    /// 收藏夹（虚拟分组）的封面；存在 group_covers 的保留键里。
    pub fn starred_cover(&self) -> Option<&str> {
        self.group_covers.get("__star__").map(|s| s.as_str())
    }

    pub fn set_starred_cover(&mut self, sha: Option<&str>) -> Result<()> {
        match sha {
            None => {
                self.group_covers.remove("__star__");
            }
            Some(sha) => {
                let ok = self
                    .assets
                    .iter()
                    .any(|a| a.sha == sha && a.starred);
                if !ok {
                    return Err(anyhow::anyhow!("封面必须是收藏里的图"));
                }
                self.group_covers
                    .insert("__star__".to_string(), sha.to_string());
            }
        }
        self.save()
    }

    pub fn pinned_groups(&self) -> &[String] {
        &self.pinned_groups
    }

    pub fn set_pinned_groups(&mut self, pinned: Vec<String>) -> Result<()> {
        let mut out: Vec<String> = Vec::new();
        for name in pinned {
            if self.known_groups.iter().any(|g| g == &name) && !out.contains(&name) {
                out.push(name);
            }
        }
        self.pinned_groups = out;
        self.save()
    }

    /// 新建分组（可以是空分组）
    pub fn create_group(&mut self, name: &str) -> Result<bool> {
        let name = name.trim();
        validate_group_name(name)?;
        if self.known_groups.iter().any(|g| g == name) {
            return Ok(false);
        }
        self.known_groups.push(name.to_string());
        self.known_groups = clean_list(std::mem::take(&mut self.known_groups));
        if !self.group_order.iter().any(|g| g == name) {
            self.group_order.push(name.to_string());
        }
        self.save()?;
        Ok(true)
    }

    pub fn remove_group(&mut self, name: &str, delete_assets: bool) -> Result<usize> {
        if delete_assets {
            let shas: Vec<String> = self
                .assets
                .iter()
                .filter(|a| a.groups.iter().any(|g| g == name))
                .map(|a| a.sha.clone())
                .collect();
            let n = shas.len();
            for sha in shas {
                self.remove(&sha)?;
            }
            self.known_groups.retain(|g| g != name);
            self.group_order.retain(|g| g != name);
            self.group_covers.remove(name);
            self.orders.remove(name);
            self.pinned_groups.retain(|g| g != name);
            self.save()?;
            return Ok(n);
        }

        self.known_groups.retain(|g| g != name);
        self.group_order.retain(|g| g != name);
        self.group_covers.remove(name);
        self.orders.remove(name);
        self.pinned_groups.retain(|g| g != name);
        let mut touched = 0;
        for a in &mut self.assets {
            if a.groups.iter().any(|g| g == name) {
                a.groups.retain(|g| g != name);
                touched += 1;
            }
        }
        self.save()?;
        Ok(touched)
    }

    /// 软删除：移进 trash/，从索引移除。文件不真删，随时能捞回来。
    pub fn remove(&mut self, sha: &str) -> Result<()> {
        let idx = self
            .assets
            .iter()
            .position(|a| a.sha == sha)
            .ok_or_else(|| anyhow::anyhow!("库里找不到这张图"))?;
        let asset = self.assets.remove(idx);

        let src = PathBuf::from(&asset.path);
        let trash = self.trash_path();
        fs::create_dir_all(&trash)?;
        let dst = trash.join(format!("{}.{}", asset.sha, asset.ext));
        if src.exists() {
            let _ = fs::remove_file(&dst);
            if fs::rename(&src, &dst).is_err() {
                fs::copy(&src, &dst)?;
            }
        }

        let mut items = self.read_trash();
        // 同一个 sha 在回收站里只保留最新一条
        items.retain(|i| i.asset.sha != asset.sha);
        items.push(TrashItem {
            asset: asset.clone(),
            deleted_at: Utc::now().to_rfc3339(),
        });
        self.write_trash(&items)?;

        self.seen.remove(&asset.sha);
        self.save()
    }

    pub fn stats(&self) -> LibraryStats {        LibraryStats {
            assets: self.assets.len(),
            bytes: self.assets.iter().map(|a| a.bytes).sum(),
            root: self.root.to_string_lossy().to_string(),
        }
    }

    /// 原子写索引
    pub fn save(&self) -> Result<()> {
        let index = IndexFile {
            version: 1,
            assets: self.assets.clone(),
            seen_ungrouped_at: self.seen_ungrouped_at.clone(),
            groups: self.known_groups.clone(),
            tags: self.known_tags.clone(),
            group_order: self.group_order.clone(),
            group_covers: self.group_covers.clone(),
            pinned_groups: self.pinned_groups.clone(),
            trash_days: self.trash_days,
            orders: self.orders.clone(),
        };
        let json = serde_json::to_string_pretty(&index)?;
        let path = self.root.join("index.json");
        let tmp = self.root.join("index.json.tmp");
        fs::write(&tmp, json)?;
        fs::rename(&tmp, &path)?;
        Ok(())
    }
}

/// 汉字 → 全拼 + 首字母。非汉字（字母数字）原样保留，方便「sample-01」这类名字也能搜。
pub fn pinyin_of(text: &str) -> (String, String) {
    let mut full = String::new();
    let mut abbr = String::new();
    for ch in text.chars() {
        if let Some(p) = ch.to_pinyin() {
            let plain = p.plain();
            full.push_str(plain);
            if let Some(c) = plain.chars().next() {
                abbr.push(c);
            }
        } else if ch.is_ascii_alphanumeric() {
            let c = ch.to_ascii_lowercase();
            full.push(c);
            abbr.push(c);
        }
    }
    (full, abbr)
}

const ASCII_READINGS: [&str; 36] = [
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f", "g", "h",
    "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z",
];

/// 每个字的所有读音（多音字会有多个）。ASCII 字符当成单字母读音。
fn readings_of(name: &str) -> Vec<Vec<&'static str>> {
    let mut out: Vec<Vec<&'static str>> = Vec::new();
    for ch in name.chars() {
        if let Some(multi) = ch.to_pinyin_multi() {
            let mut alts: Vec<&'static str> = Vec::new();
            for p in multi.into_iter() {
                let plain = p.plain();
                if !alts.contains(&plain) {
                    alts.push(plain);
                }
            }
            if !alts.is_empty() {
                out.push(alts);
            }
        } else if ch.is_ascii_alphanumeric() {
            let idx = if ch.is_ascii_digit() {
                (ch as u8 - b'0') as usize
            } else {
                10 + (ch.to_ascii_lowercase() as u8 - b'a') as usize
            };
            out.push(vec![ASCII_READINGS[idx]]);
        }
    }
    out
}

/// 查询串能否从某个字开始，被「逐字读音」消费掉。
/// 每个字可以给全拼或首字母；最后一个字允许只打前缀（比如 wangy → 网易）。
fn pinyin_hit(readings: &[Vec<&'static str>], q: &str) -> Option<usize> {
    if q.is_empty() || readings.is_empty() {
        return None;
    }
    let qb = q.as_bytes();
    let n = readings.len();

    for start in 0..n {
        let tail = &readings[start..];
        let mut reach = vec![false; qb.len() + 1];
        reach[0] = true;

        for (i, alts) in tail.iter().enumerate() {
            let mut next = vec![false; qb.len() + 1];
            let mut any = false;
            for j in 0..=qb.len() {
                if !reach[j] {
                    continue;
                }
                for r in alts {
                    let rb = r.as_bytes();
                    if j + rb.len() <= qb.len() && &qb[j..j + rb.len()] == rb {
                        next[j + rb.len()] = true;
                        any = true;
                    }
                    if j < qb.len() && qb[j] == rb[0] {
                        next[j + 1] = true;
                        any = true;
                    }
                    // 名字最后一个字允许只输入前缀
                    if i == tail.len() - 1 && j < qb.len() {
                        let rest = &qb[j..];
                        if rest.len() < rb.len() && &rb[..rest.len()] == rest {
                            next[qb.len()] = true;
                            any = true;
                        }
                    }
                }
            }
            if !any {
                break;
            }
            if next[qb.len()] {
                return Some(start);
            }
            reach = next;
        }
    }
    None
}

fn clean_list(items: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for s in items {
        let s = s.trim().to_string();
        if !s.is_empty() && !out.contains(&s) {
            out.push(s);
        }
    }
    out
}

/// 搜索打分：标题直接命中 > 拼音命中 > 标签命中 > 分组命中。
/// 分组名的保留字与格式校验。
/// 这些名字和侧栏的固定项同名时会让人分不清，`__` 前缀则是内部标识专用。
pub fn validate_group_name(name: &str) -> Result<()> {
    let n = name.trim();
    if n.is_empty() {
        anyhow::bail!("名字不能为空");
    }
    if n.chars().count() > 30 {
        anyhow::bail!("名字不能超过 30 个字");
    }
    if n.starts_with("__") {
        anyhow::bail!("名字不能以 __ 开头（这是内部保留格式）");
    }
    const RESERVED: [&str; 5] = ["全部", "收藏", "最近使用", "未分组", "回收站"];
    if RESERVED.contains(&n) {
        anyhow::bail!("「{}」是保留名称，换一个吧", n);
    }
    if n.chars().any(|c| c.is_control()) {
        anyhow::bail!("名字里不能有控制字符");
    }
    Ok(())
}

pub fn match_score(a: &Asset, q: &str) -> i32 {
    let name = a.name.to_lowercase();

    if name == q {
        return 1000;
    }
    if name.starts_with(q) {
        return 900;
    }
    if !a.py.is_empty() && a.py == q {
        return 860;
    }
    if !a.py.is_empty() && a.py.starts_with(q) {
        return 820;
    }
    if !a.py_abbr.is_empty() && a.py_abbr == q {
        return 800;
    }
    if !a.py_abbr.is_empty() && a.py_abbr.starts_with(q) {
        return 780;
    }

    // 多音字 / 首字母混打：走逐字动态规划
    let hit = pinyin_hit(&a.readings, q);
    if let Some(0) = hit {
        return 700;
    }

    if name.contains(q) {
        return 600;
    }
    if !a.py.is_empty() && a.py.contains(q) {
        return 520;
    }
    if !a.py_abbr.is_empty() && a.py_abbr.contains(q) {
        return 500;
    }
    if hit.is_some() {
        return 450;
    }
    if a.tags.iter().any(|t| t.to_lowercase() == q) {
        return 420;
    }
    if a.tags.iter().any(|t| t.to_lowercase().contains(q)) {
        return 320;
    }
    if a.groups.iter().any(|g| g.to_lowercase().contains(q)) {
        return 260;
    }
    if a.ext == q {
        return 200;
    }
    0
}

/// 浏览器桥传过来的名字可能是文件名（带后缀）；库里 `name` 存不带后缀的展示名。
fn media_name(name: &str, ext: &str) -> String {
    let name = name.trim();
    let suffix = format!(".{ext}");
    let stem = if name.to_ascii_lowercase().ends_with(&suffix) {
        &name[..name.len() - suffix.len()]
    } else {
        name
    };
    let stem = stem.trim();
    if stem.is_empty() {
        "untitled".to_string()
    } else {
        stem.to_string()
    }
}

/// 只扫文件头，不解码：判断是不是多帧。
/// - GIF：一律当动图（静态 GIF 极少，代价可忽略）
/// - APNG：PNG 里有 acTL 块
/// - 动画 WebP：RIFF 里有 ANIM 块
fn looks_animated(path: &Path, ext: &str) -> bool {
    if ext == "gif" {
        return true;
    }
    if !matches!(ext, "png" | "webp") {
        return false;
    }

    use std::io::Read;
    let mut head = [0u8; 8192];
    let Ok(mut file) = fs::File::open(path) else {
        return false;
    };
    let n = file.read(&mut head).unwrap_or(0);
    let head = &head[..n];

    let needle: &[u8] = if ext == "png" { b"acTL" } else { b"ANIM" };
    head.windows(needle.len()).any(|w| w == needle)
}

/// 缩略图路径（有透明通道的存 webp，没有的存 jpg）
pub fn thumb_path(root: &Path, sha: &str, ext: &str) -> PathBuf {
    let a = sha.get(0..2).unwrap_or("00");
    let b = sha.get(2..4).unwrap_or("00");
    root.join("thumbs")
        .join(a)
        .join(b)
        .join(format!("{sha}.{ext}"))
}

/// 从任意源文件生成缩略图（回收站里的图不在 blobs 下，要单独指定源）
pub fn ensure_thumb_from(root: &Path, sha: &str, src: &Path) -> Result<PathBuf> {
    for candidate in [thumb_path(root, sha, "jpg"), thumb_path(root, sha, "webp")] {
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    let img = image::open(src).with_context(|| format!("读取 {}", src.display()))?;
    let thumb = img.resize(320, 320, image::imageops::FilterType::Lanczos3);

    let has_alpha = thumb.color().has_alpha()
        && thumb.to_rgba8().pixels().any(|p| p.0[3] < 250);

    let (dst, format) = if has_alpha {
        (thumb_path(root, sha, "webp"), image::ImageFormat::WebP)
    } else {
        (thumb_path(root, sha, "jpg"), image::ImageFormat::Jpeg)
    };

    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent)?;
    }

    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = dst.with_extension(format!("{nanos}.tmp"));

    if format == image::ImageFormat::Jpeg {
        let file = fs::File::create(&tmp)?;
        let mut writer = std::io::BufWriter::new(file);
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut writer, 82);
        encoder.encode_image(&thumb)?;
    } else {
        thumb.save_with_format(&tmp, format)?;
    }

    fs::rename(&tmp, &dst)?;
    Ok(dst)
}

/// 生成（或复用）缩略图：长边 320。
/// 有透明通道 → WebP 无损；没有 → JPEG q82（体积只有前者的 1/5）。
/// 动图只取第一帧——列表里本来就该是静态的。
pub fn ensure_thumb(root: &Path, sha: &str, ext: &str) -> Result<PathBuf> {
    for candidate in [thumb_path(root, sha, "jpg"), thumb_path(root, sha, "webp")] {
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    let src = blob_path_for(root, sha, ext);
    let img = image::open(&src).with_context(|| format!("读取 {}", src.display()))?;
    let thumb = img.resize(320, 320, image::imageops::FilterType::Lanczos3);

    let has_alpha = thumb.color().has_alpha()
        && thumb
            .to_rgba8()
            .pixels()
            .any(|p| p.0[3] < 250);

    let (dst, format) = if has_alpha {
        (thumb_path(root, sha, "webp"), image::ImageFormat::WebP)
    } else {
        (thumb_path(root, sha, "jpg"), image::ImageFormat::Jpeg)
    };

    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent)?;
    }

    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = dst.with_extension(format!("{nanos}.tmp"));

    if format == image::ImageFormat::Jpeg {
        // image crate 的 JPEG 编码默认质量 75，这里显式给 82
        let file = fs::File::create(&tmp)?;
        let mut writer = std::io::BufWriter::new(file);
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut writer, 82);
        encoder.encode_image(&thumb)?;
    } else {
        thumb.save_with_format(&tmp, format)?;
    }

    fs::rename(&tmp, &dst)?;
    Ok(dst)
}

/// RGBA 像素编码成 PNG（剪贴板捕获用）
pub fn rgba_to_png(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>> {
    let img = image::RgbaImage::from_raw(width, height, rgba.to_vec())
        .ok_or_else(|| anyhow::anyhow!("像素数据长度不匹配"))?;
    let mut buf: Vec<u8> = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)?;
    Ok(buf)
}

/// 解码成 RGBA8 原始像素（给剪贴板用）。动图只取首帧。
pub fn load_rgba(path: &Path) -> Result<(u32, u32, Vec<u8>)> {    let img = image::open(path).with_context(|| format!("解码失败 {}", path.display()))?;
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    Ok((w, h, rgba.into_raw()))
}

/// 递归收集目录下的图片文件（不读内容，只列路径）
pub fn collect_images(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in WalkDir::new(dir)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_file() && image_ext(entry.path()).is_some() {
            out.push(entry.path().to_path_buf());
        }
    }
}

/// 图片扩展名（小写），非图片返回 None
pub fn image_ext(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    if IMAGE_EXTS.contains(&ext.as_str()) {
        Some(ext)
    } else {
        None
    }
}

fn blob_path_for(root: &Path, sha: &str, ext: &str) -> PathBuf {
    let a = sha.get(0..2).unwrap_or("00");
    let b = sha.get(2..4).unwrap_or("00");
    root.join("blobs")
        .join(a)
        .join(b)
        .join(format!("{sha}.{ext}"))
}

fn is_sha_like(s: &str) -> bool {
    s.len() >= 32 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

fn hex(bytes: &[u8]) -> String {
    const TABLE: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(TABLE[(b >> 4) as usize] as char);
        s.push(TABLE[(b & 0x0f) as usize] as char);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_works() {
        assert_eq!(hex(&[0x00, 0xff, 0x1a]), "00ff1a");
    }

    #[test]
    fn pinyin_basics() {
        assert_eq!(pinyin_of("无语"), ("wuyu".to_string(), "wy".to_string()));
        assert_eq!(pinyin_of("猫猫1"), ("maomao1".to_string(), "mm1".to_string()));
        assert_eq!(pinyin_of("abc"), ("abc".to_string(), "abc".to_string()));
    }

    #[test]
    fn trash_roundtrip() {
        let base = std::env::temp_dir().join(format!("sb-trash-{}", std::process::id()));
        let src = base.join("src");
        std::fs::create_dir_all(&src).unwrap();
        image::RgbaImage::from_pixel(2, 2, image::Rgba([10, 20, 30, 255]))
            .save(src.join("a.png"))
            .unwrap();
        image::RgbaImage::from_pixel(2, 2, image::Rgba([40, 50, 60, 255]))
            .save(src.join("b.png"))
            .unwrap();

        let mut lib = Library::open(base.join("lib")).unwrap();
        lib.scan_folder(&src).unwrap();
        assert_eq!(lib.assets().len(), 2);

        let sha = lib.assets()[0].sha.clone();
        lib.remove(&sha).unwrap();
        assert_eq!(lib.assets().len(), 1);
        assert_eq!(lib.trash().len(), 1);

        lib.restore(&sha).unwrap();
        assert_eq!(lib.assets().len(), 2);
        assert_eq!(lib.trash().len(), 0);

        lib.remove(&sha).unwrap();
        let paths = lib.purge_trash().unwrap();
        assert_eq!(paths.len(), 1);
        for p in &paths {
            std::fs::remove_file(p).unwrap();
        }
        assert_eq!(lib.trash().len(), 0);

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn group_meta_roundtrip() {
        let base = std::env::temp_dir().join(format!("sb-gmeta-{}", std::process::id()));
        let src = base.join("src");
        std::fs::create_dir_all(&src).unwrap();
        for i in 0..2u8 {
            image::RgbaImage::from_pixel(2, 2, image::Rgba([i + 1, 2, 3, 255]))
                .save(src.join(format!("g{i}.png")))
                .unwrap();
        }
        let mut lib = Library::open(base.join("lib")).unwrap();
        lib.scan_folder(&src).unwrap();
        let shas: Vec<String> = lib.assets().iter().map(|a| a.sha.clone()).collect();
        lib.create_group("甲").unwrap();
        lib.create_group("乙").unwrap();
        lib.add_group(&shas[..1], "甲").unwrap();
        lib.add_group(&shas[1..], "乙").unwrap();
        lib.set_group_order(&["乙".to_string(), "甲".to_string()]).unwrap();
        lib.set_group_cover("乙", Some(&shas[1])).unwrap();
        assert!(lib.set_group_cover("乙", Some(&shas[0])).is_err());
        lib.set_pinned_groups(vec!["甲".to_string()]).unwrap();

        let mut lib = Library::open(base.join("lib")).unwrap();
        assert_eq!(lib.group_order(), &["乙".to_string(), "甲".to_string()]);
        assert_eq!(lib.group_cover("乙"), Some(shas[1].as_str()));
        assert_eq!(lib.pinned_groups(), &["甲".to_string()]);

        lib.rename_group("乙", "丙").unwrap();
        assert_eq!(lib.group_cover("丙"), Some(shas[1].as_str()));
        assert!(lib.group_order().iter().any(|g| g == "丙"));
        lib.remove_group("丙", false).unwrap();
        assert!(lib.group_cover("丙").is_none());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn trash_days_roundtrip_and_expiry() {
        let base = std::env::temp_dir().join(format!("sb-trashdays-{}", std::process::id()));
        let src = base.join("src");
        std::fs::create_dir_all(&src).unwrap();
        image::RgbaImage::from_pixel(2, 2, image::Rgba([9, 9, 9, 255]))
            .save(src.join("old.png"))
            .unwrap();
        image::RgbaImage::from_pixel(2, 2, image::Rgba([7, 7, 7, 255]))
            .save(src.join("new.png"))
            .unwrap();

        let mut lib = Library::open(base.join("lib")).unwrap();
        assert_eq!(lib.trash_days(), 7);
        lib.scan_folder(&src).unwrap();
        let shas: Vec<String> = lib.assets().iter().map(|a| a.sha.clone()).collect();
        lib.remove(&shas[0]).unwrap();
        lib.remove(&shas[1]).unwrap();
        let mut items = lib.trash();
        assert_eq!(items.len(), 2);
        // 手动把其中一条改成 10 天前删除
        items[0].deleted_at = (Utc::now() - chrono::Duration::days(10)).to_rfc3339();
        lib.write_trash(&items).unwrap();

        let mut handled = Vec::new();
        let n = lib
            .purge_expired_trash(|p| {
                handled.push(p.to_path_buf());
                std::fs::remove_file(p).is_ok()
            })
            .unwrap();
        assert_eq!(n, 1);
        assert_eq!(handled.len(), 1, "只处理过期的那一条");
        assert!(!handled[0].exists());
        assert_eq!(lib.trash().len(), 1);

        lib.set_trash_days(30).unwrap();
        let mut lib = Library::open(base.join("lib")).unwrap();
        assert_eq!(lib.trash_days(), 30);
        let _ = std::fs::remove_dir_all(&base);
    }

    /// 到期项的处理失败了（比如系统回收站拒绝）：文件和元数据都留着，下一轮再试。
    #[test]
    fn purge_expired_keeps_item_when_removal_fails() {
        let base = std::env::temp_dir().join(format!("sb-purge-retry-{}", std::process::id()));
        let src = base.join("src");
        std::fs::create_dir_all(&src).unwrap();
        image::RgbaImage::from_pixel(2, 2, image::Rgba([3, 2, 1, 255]))
            .save(src.join("a.png"))
            .unwrap();

        let mut lib = Library::open(base.join("lib")).unwrap();
        lib.scan_folder(&src).unwrap();
        let sha = lib.assets()[0].sha.clone();
        lib.remove(&sha).unwrap();
        let mut items = lib.trash();
        items[0].deleted_at = (Utc::now() - chrono::Duration::days(10)).to_rfc3339();
        lib.write_trash(&items).unwrap();
        let path = lib.trash_file_path(&sha).unwrap();

        assert_eq!(lib.purge_expired_trash(|_| false).unwrap(), 0);
        assert_eq!(lib.trash().len(), 1);
        assert!(path.exists(), "没处理掉的文件不能被删");

        // 下一轮成功后才清条目
        assert_eq!(
            lib.purge_expired_trash(|p| std::fs::remove_file(p).is_ok())
                .unwrap(),
            1
        );
        assert!(lib.trash().is_empty());
        let _ = std::fs::remove_dir_all(&base);
    }

    /// `Library::open` 只读元数据，不再自己删过期文件；删除策略由壳按 deleteMode 决定。
    #[test]
    fn open_does_not_purge_expired_trash() {
        let base = std::env::temp_dir().join(format!("sb-open-nopurge-{}", std::process::id()));
        let src = base.join("src");
        std::fs::create_dir_all(&src).unwrap();
        image::RgbaImage::from_pixel(2, 2, image::Rgba([8, 8, 8, 255]))
            .save(src.join("a.png"))
            .unwrap();

        let mut lib = Library::open(base.join("lib")).unwrap();
        lib.scan_folder(&src).unwrap();
        let sha = lib.assets()[0].sha.clone();
        lib.remove(&sha).unwrap();
        let mut items = lib.trash();
        items[0].deleted_at = (Utc::now() - chrono::Duration::days(10)).to_rfc3339();
        lib.write_trash(&items).unwrap();
        let path = lib.trash_file_path(&sha).unwrap();
        drop(lib);

        let lib = Library::open(base.join("lib")).unwrap();
        assert_eq!(lib.trash().len(), 1, "打开库时不能偷偷永久删");
        assert!(path.exists());
        let _ = std::fs::remove_dir_all(&base);
    }

    /// 从系统回收站还原回来的文件、或老版本清元数据失败留下的文件，
    /// 都应该被收养进回收站列表（否则界面永远 0 张，到期也清不掉）。
    #[test]
    fn orphan_trash_files_are_adopted() {
        let base = std::env::temp_dir().join(format!("sb-adopt-{}", std::process::id()));
        let mut lib = Library::open(base.join("lib")).unwrap();
        let sha = "ab".repeat(32);
        std::fs::create_dir_all(lib.trash_path()).unwrap();
        std::fs::write(lib.trash_path().join(format!("{sha}.png")), b"not-a-real-image").unwrap();        std::fs::write(lib.trash_path().join("index.json"), b"[]").unwrap();

        let items = lib.trash();
        assert_eq!(items.len(), 1, "孤儿文件应该被收养");
        assert_eq!(items[0].asset.sha, sha);
        assert_eq!(items[0].asset.ext, "png");
        assert_eq!(items[0].asset.bytes, 16);
        assert!(items[0].asset.name.starts_with("未命名-"));

        // 元数据已经写回，第二次不会再收养一遍
        let txt = std::fs::read_to_string(lib.trash_path().join("index.json")).unwrap();
        assert!(txt.contains(&sha));
        assert_eq!(lib.trash().len(), 1);

        // 非 sha 名字的杂文件不收养
        std::fs::write(lib.trash_path().join("readme.png"), b"x").unwrap();
        assert_eq!(lib.trash().len(), 1);
        let _ = std::fs::remove_dir_all(&base);
    }

    /// 到期清理时文件已经不在（用户手动删了）也要把元数据收掉。
    #[test]
    fn purge_expired_handles_missing_files() {
        let base = std::env::temp_dir().join(format!("sb-purge-missing-{}", std::process::id()));
        let src = base.join("src");
        std::fs::create_dir_all(&src).unwrap();
        image::RgbaImage::from_pixel(2, 2, image::Rgba([1, 2, 3, 255]))
            .save(src.join("a.png"))
            .unwrap();
        image::RgbaImage::from_pixel(2, 2, image::Rgba([4, 5, 6, 255]))
            .save(src.join("b.png"))
            .unwrap();

        let mut lib = Library::open(base.join("lib")).unwrap();
        lib.scan_folder(&src).unwrap();
        let shas: Vec<String> = lib.assets().iter().map(|a| a.sha.clone()).collect();
        lib.remove(&shas[0]).unwrap();
        lib.remove(&shas[1]).unwrap();
        let mut items = lib.trash();
        assert_eq!(items.len(), 2);
        for it in items.iter_mut() {
            it.deleted_at = (Utc::now() - chrono::Duration::days(10)).to_rfc3339();
        }
        lib.write_trash(&items).unwrap();
        // 其中一条文件被用户手动删了
        let gone = lib.trash().remove(0);
        std::fs::remove_file(
            lib.trash_path()
                .join(format!("{}.{}", gone.asset.sha, gone.asset.ext)),
        )
        .unwrap();

        let mut calls = 0;
        let n = lib
            .purge_expired_trash(|p| {
                calls += 1;
                std::fs::remove_file(p).is_ok()
            })
            .unwrap();
        assert_eq!(n, 2);
        assert_eq!(calls, 1, "文件已不在的那条不再调删除回调");
        assert!(lib.trash().is_empty());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn create_group_is_idempotent() {        let base = std::env::temp_dir().join(format!("sb-group-idem-{}", std::process::id()));
        let mut lib = Library::open(&base).unwrap();
        assert!(lib.create_group("同一组").unwrap());
        assert!(!lib.create_group("同一组").unwrap());
        assert_eq!(
            lib.group_stats().iter().filter(|(n, _)| n == "同一组").count(),
            1
        );
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn rename_group_updates_registry() {
        let base = std::env::temp_dir().join(format!("sb-group-rename-{}", std::process::id()));
        let mut lib = Library::open(&base).unwrap();
        lib.create_group("旧名字").unwrap();
        lib.rename_group("旧名字", "新名字").unwrap();
        let names: Vec<String> = lib.group_stats().into_iter().map(|(n, _)| n).collect();
        assert!(names.contains(&"新名字".to_string()));
        assert!(!names.contains(&"旧名字".to_string()));
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn tag_registry_lifecycle() {
        let base = std::env::temp_dir().join(format!("sb-tags-{}", std::process::id()));
        let src = base.join("src");
        std::fs::create_dir_all(&src).unwrap();
        for (i, name) in ["t0.png", "t1.png"].iter().enumerate() {
            image::RgbaImage::from_pixel(2, 2, image::Rgba([i as u8 + 1, 2, 3, 255]))
                .save(src.join(name))
                .unwrap();
        }
        let mut lib = Library::open(base.join("lib")).unwrap();
        lib.scan_folder(&src).unwrap();
        let shas: Vec<String> = lib.assets().iter().map(|a| a.sha.clone()).collect();

        assert!(lib.create_tag("空标签").unwrap());
        assert!(!lib.create_tag("空标签").unwrap());
        assert!(lib
            .tag_stats()
            .iter()
            .any(|(n, c)| n == "空标签" && *c == 0));

        lib.add_tags(&shas, vec!["甲".into(), "乙".into()]).unwrap();
        let count = |lib: &Library, name: &str| {
            lib.tag_stats()
                .into_iter()
                .find(|(n, _)| n == name)
                .map(|(_, c)| c)
                .unwrap_or(0)
        };
        assert_eq!(count(&lib, "甲"), 2);
        assert_eq!(count(&lib, "乙"), 2);

        lib.set_asset_tags(&shas[0], vec!["乙".into()]).unwrap();
        assert_eq!(count(&lib, "甲"), 1);
        assert_eq!(count(&lib, "乙"), 2);

        lib.rename_tag("甲", "丙").unwrap();
        assert_eq!(count(&lib, "甲"), 0);
        assert_eq!(count(&lib, "丙"), 1);

        lib.merge_tags("乙", "丙").unwrap();
        assert_eq!(count(&lib, "乙"), 0);
        assert_eq!(count(&lib, "丙"), 2);

        lib.delete_tag("丙").unwrap();
        assert_eq!(count(&lib, "丙"), 0);
        assert!(!lib
            .assets()
            .iter()
            .any(|a| a.tags.iter().any(|t| t == "丙")));

        // 重开：空标签还在，删掉的标签不会回来
        let lib = Library::open(base.join("lib")).unwrap();
        assert!(lib
            .tag_stats()
            .iter()
            .any(|(n, c)| n == "空标签" && *c == 0));
        assert!(!lib.tag_stats().iter().any(|(n, _)| n == "丙"));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn update_registers_new_tags() {
        let base = std::env::temp_dir().join(format!("sb-update-tags-{}", std::process::id()));
        let src = base.join("src");
        std::fs::create_dir_all(&src).unwrap();
        image::RgbaImage::from_pixel(2, 2, image::Rgba([7, 8, 9, 255]))
            .save(src.join("u.png"))
            .unwrap();
        let mut lib = Library::open(base.join("lib")).unwrap();
        lib.scan_folder(&src).unwrap();
        let sha = lib.assets()[0].sha.clone();

        // 桌面编辑弹窗保存走 update()：新标签要立刻进登记表，不能等重开库
        lib.update(&sha, None, Some(vec!["编辑新建".into()]), None)
            .unwrap();
        assert!(lib
            .tag_stats()
            .iter()
            .any(|(n, c)| n == "编辑新建" && *c == 1));

        // 从图里移出后仍留在登记表（0 引用），与 add_tags 语义一致
        lib.update(&sha, None, Some(vec![]), None).unwrap();
        assert!(lib
            .tag_stats()
            .iter()
            .any(|(n, c)| n == "编辑新建" && *c == 0));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn delete_tag_also_clears_trash() {
        let base = std::env::temp_dir().join(format!("sb-tag-trash-{}", std::process::id()));
        let src = base.join("src");
        std::fs::create_dir_all(&src).unwrap();
        image::RgbaImage::from_pixel(2, 2, image::Rgba([4, 5, 6, 255]))
            .save(src.join("trash.png"))
            .unwrap();
        let mut lib = Library::open(base.join("lib")).unwrap();
        lib.scan_folder(&src).unwrap();
        let sha = lib.assets()[0].sha.clone();
        lib.add_tags(&[sha.clone()], vec!["甲".into()]).unwrap();
        lib.remove(&sha).unwrap();
        lib.delete_tag("甲").unwrap();
        lib.restore(&sha).unwrap();
        assert!(!lib.assets()[0].tags.iter().any(|t| t == "甲"));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn empty_query_returns_all_trash() {
        let base = std::env::temp_dir().join(format!("sb-trash-empty-{}", std::process::id()));
        let src = base.join("src");
        std::fs::create_dir_all(&src).unwrap();
        image::RgbaImage::from_pixel(2, 2, image::Rgba([9, 9, 9, 255]))
            .save(src.join("x.png"))
            .unwrap();
        let mut lib = Library::open(base.join("lib")).unwrap();
        lib.scan_folder(&src).unwrap();
        let sha = lib.assets()[0].sha.clone();
        lib.remove(&sha).unwrap();
        assert_eq!(lib.search_trash("").len(), 1);
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn clearing_order_restores_original() {
        let base = std::env::temp_dir().join(format!("sb-order-clear-{}", std::process::id()));
        let src = base.join("src");
        std::fs::create_dir_all(&src).unwrap();
        for (i, name) in ["a.png", "b.png"].iter().enumerate() {
            image::RgbaImage::from_pixel(2, 2, image::Rgba([i as u8, 3, 4, 255]))
                .save(src.join(name))
                .unwrap();
        }
        let mut lib = Library::open(base.join("lib")).unwrap();
        lib.scan_folder(&src).unwrap();
        let shas: Vec<String> = lib.assets().iter().map(|a| a.sha.clone()).collect();
        lib.set_order("g", vec![shas[1].clone(), shas[0].clone()]).unwrap();
        lib.set_order("g", vec![]).unwrap();
        let got: Vec<String> = lib.ordered("g", lib.assets().to_vec()).iter().map(|a| a.sha.clone()).collect();
        assert_eq!(got, shas);
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn group_name_reserved_words() {
        assert!(validate_group_name("猫猫").is_ok());
        assert!(validate_group_name("").is_err());
        assert!(validate_group_name("全部").is_err());
        assert!(validate_group_name("回收站").is_err());
        assert!(validate_group_name("__star__").is_err());
        assert!(validate_group_name(&"字".repeat(31)).is_err());

        let base = std::env::temp_dir().join(format!("sb-reserved-{}", std::process::id()));
        let mut lib = Library::open(&base).unwrap();
        assert!(lib.create_group("收藏").is_err());
        assert!(lib.create_group("正常分组").is_ok());
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn manual_order_persists() {
        let base = std::env::temp_dir().join(format!("sb-order-{}", std::process::id()));
        let src = base.join("src");
        std::fs::create_dir_all(&src).unwrap();
        for (i, name) in ["a.png", "b.png", "c.png"].iter().enumerate() {
            image::RgbaImage::from_pixel(2, 2, image::Rgba([i as u8, 1, 2, 255]))
                .save(src.join(name))
                .unwrap();
        }

        let mut lib = Library::open(base.join("lib")).unwrap();
        lib.scan_folder(&src).unwrap();
        let mut shas: Vec<String> = lib.assets().iter().map(|a| a.sha.clone()).collect();
        shas.reverse();
        lib.set_order("g", shas.clone()).unwrap();

        let got: Vec<String> = lib
            .ordered("g", lib.assets().to_vec())
            .iter()
            .map(|a| a.sha.clone())
            .collect();
        assert_eq!(got, shas);

        drop(lib);
        let lib = Library::open(base.join("lib")).unwrap();
        let got2: Vec<String> = lib
            .ordered("g", lib.assets().to_vec())
            .iter()
            .map(|a| a.sha.clone())
            .collect();
        assert_eq!(got2, shas);

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn empty_group_can_be_created_and_removed() {
        let base = std::env::temp_dir().join(format!("sb-groups-{}", std::process::id()));
        let mut lib = Library::open(&base).unwrap();

        assert!(lib.create_group("空分组").unwrap());
        let stats = lib.group_stats();
        assert!(stats.iter().any(|(n, c)| n == "空分组" && *c == 0));

        // 重开后仍然存在
        drop(lib);
        let mut lib = Library::open(&base).unwrap();
        assert!(lib.group_stats().iter().any(|(n, _)| n == "空分组"));

        lib.remove_group("空分组", false).unwrap();
        assert!(!lib.group_stats().iter().any(|(n, _)| n == "空分组"));

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn trash_search_by_name_and_pinyin() {
        let base = std::env::temp_dir().join(format!("sb-trashq-{}", std::process::id()));
        let src = base.join("src");
        std::fs::create_dir_all(&src).unwrap();
        image::RgbaImage::from_pixel(2, 2, image::Rgba([1, 2, 3, 255]))
            .save(src.join("猫猫开心.png"))
            .unwrap();

        let mut lib = Library::open(base.join("lib")).unwrap();
        lib.scan_folder(&src).unwrap();
        let sha = lib.assets()[0].sha.clone();
        lib.remove(&sha).unwrap();

        assert_eq!(lib.search_trash("猫").len(), 1);
        assert_eq!(lib.search_trash("mm").len(), 1);
        assert_eq!(lib.search_trash("maomao").len(), 1);
        assert_eq!(lib.search_trash("不存在").len(), 0);

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn restore_after_reimport_merges() {
        let base = std::env::temp_dir().join(format!("sb-merge-{}", std::process::id()));
        let src = base.join("src");
        std::fs::create_dir_all(&src).unwrap();
        image::RgbaImage::from_pixel(2, 2, image::Rgba([7, 8, 9, 255]))
            .save(src.join("a.png"))
            .unwrap();

        let mut lib = Library::open(base.join("lib")).unwrap();
        lib.scan_folder(&src).unwrap();
        let sha = lib.assets()[0].sha.clone();

        lib.remove(&sha).unwrap();
        assert_eq!(lib.assets().len(), 0);
        assert_eq!(lib.trash().len(), 1);

        // 删掉后又重新导入同一张
        lib.scan_folder(&src).unwrap();
        assert_eq!(lib.assets().len(), 1);

        // 再恢复：不能变成两张
        lib.restore(&sha).unwrap();
        assert_eq!(lib.assets().len(), 1);
        assert_eq!(lib.trash().len(), 0);

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn animation_detection() {
        let dir = std::env::temp_dir().join(format!("sb-anim-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let gif = dir.join("a.gif");
        std::fs::write(&gif, b"GIF89a").unwrap();
        assert!(looks_animated(&gif, "gif"));

        let png = dir.join("b.png");
        std::fs::write(&png, b"PNG-junk-without-the-animation-chunk").unwrap();
        assert!(!looks_animated(&png, "png"));

        let apng = dir.join("c.png");
        std::fs::write(&apng, b"PNG-junk-with-acTL-chunk").unwrap();
        assert!(looks_animated(&apng, "png"));

        let webp = dir.join("d.webp");
        std::fs::write(&webp, b"RIFFxxxxWEBPANIM").unwrap();
        assert!(looks_animated(&webp, "webp"));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn heteronym_search() {
        let base = std::env::temp_dir().join(format!("sb-hy-{}", std::process::id()));
        let src = base.join("src");
        std::fs::create_dir_all(&src).unwrap();
        image::RgbaImage::from_pixel(3, 3, image::Rgba([1, 2, 3, 255]))
            .save(src.join("银行业.png"))
            .unwrap();
        image::RgbaImage::from_pixel(3, 3, image::Rgba([9, 8, 7, 255]))
            .save(src.join("网易云音乐.png"))
            .unwrap();

        let mut lib = Library::open(base.join("lib")).unwrap();
        lib.scan_folder(&src).unwrap();

        // 「行」有 hang / xing 两个读音，两种打法都要能搜到
        assert_eq!(lib.search("yhy", None, 10).len(), 1);
        assert_eq!(lib.search("yxy", None, 10).len(), 1);
        assert_eq!(lib.search("yinhangye", None, 10).len(), 1);
        assert_eq!(lib.search("yinxingye", None, 10).len(), 1);

        // 「网易云音乐」首字母
        assert_eq!(lib.search("wyy", None, 10).len(), 1);
        assert_eq!(lib.search("wangyiyunyinyue", None, 10).len(), 1);

        // 不应该串味
        assert_eq!(lib.search("wyy", None, 10)[0].name, "网易云音乐");

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn search_by_pinyin_and_group() {
        let base = std::env::temp_dir().join(format!("sb-test-{}", std::process::id()));
        let src = base.join("src");
        std::fs::create_dir_all(&src).unwrap();
        let red = image::RgbaImage::from_pixel(2, 2, image::Rgba([255, 0, 0, 255]));
        let blue = image::RgbaImage::from_pixel(2, 2, image::Rgba([0, 0, 255, 255]));
        red.save(src.join("无语.png")).unwrap();
        blue.save(src.join("开心.png")).unwrap();

        let mut lib = Library::open(base.join("lib")).unwrap();
        let stats = lib.scan_folder(&src).unwrap();
        assert_eq!(stats.added, 2);

        assert_eq!(lib.search("无语", None, 10).len(), 1);
        assert_eq!(lib.search("wuyu", None, 10).len(), 1);
        assert_eq!(lib.search("wy", None, 10).len(), 1);
        assert_eq!(lib.search("bx", None, 10).len(), 0);

        let sha = lib.search("无语", None, 1)[0].sha.clone();
        lib.update(&sha, None, Some(vec!["工作".into()]), Some(vec!["猫猫".into()]))
            .unwrap();
        assert_eq!(lib.search("工作", None, 10).len(), 1);
        assert_eq!(lib.search("无语", Some("猫猫"), 10).len(), 1);
        assert_eq!(lib.search("", Some("猫猫"), 10).len(), 1);
        assert_eq!(lib.search("", Some(""), 10).len(), 1);
        assert_eq!(lib.search("无语", Some(""), 10).len(), 0);
        assert_eq!(lib.group_stats(), vec![("猫猫".to_string(), 1)]);

        std::fs::remove_dir_all(&base).ok();
    }

    fn gif_bytes(frames: u8) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut enc = image::codecs::gif::GifEncoder::new(&mut buf);
            enc.set_repeat(image::codecs::gif::Repeat::Infinite).unwrap();
            for i in 0..frames {
                let frame = image::RgbaImage::from_pixel(3, 2, image::Rgba([i * 40, 20, 30, 255]));
                enc.encode_frame(image::Frame::new(frame)).unwrap();
            }
        }
        buf
    }

    fn png_bytes() -> Vec<u8> {
        let mut buf = Vec::new();
        image::RgbaImage::from_pixel(4, 5, image::Rgba([1, 2, 3, 255]))
            .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
            .unwrap();
        buf
    }

    #[test]
    fn import_media_bytes_marks_animated_and_keeps_meta() {
        let base = std::env::temp_dir().join(format!("sb-media-gif-{}", std::process::id()));
        let mut lib = Library::open(base.join("lib")).unwrap();

        let res = lib
            .import_media_bytes(
                gif_bytes(3),
                "GIF",
                " emoji-123.gif ",
                "bilibili",
                "https://i0.hdslb.com/bfs/x.gif",
                vec!["猫".into(), "猫".into()],
                vec!["表情".into()],
            )
            .unwrap();
        assert!(res.added);
        assert_eq!(res.sha.len(), 64);

        let a = lib.assets().iter().find(|a| a.sha == res.sha).unwrap();
        assert!(a.animated, "GIF 必须标成动图");
        assert_eq!(a.ext, "gif");
        assert_eq!((a.width, a.height), (3, 2));
        assert_eq!(a.name, "emoji-123");
        assert_eq!(a.source, "bilibili");
        assert_eq!(a.source_ref, "https://i0.hdslb.com/bfs/x.gif");
        assert_eq!(a.tags, vec!["猫".to_string()]);
        assert_eq!(a.groups, vec!["表情".to_string()]);
        assert!(lib.blob_path(&res.sha, "gif").exists());
        assert!(lib.search("emoji", None, 10).len() == 1);
        // 标签/分组要立刻进登记表，侧栏和标签管理不用重开库
        assert!(lib.group_stats().iter().any(|(n, _)| n == "表情"));
        assert!(lib.tag_stats().iter().any(|(n, _)| n == "猫"));

        // 落盘后 animated 不能丢
        let lib = Library::open(base.join("lib")).unwrap();
        let a = lib.assets().iter().find(|a| a.sha == res.sha).unwrap();
        assert!(a.animated);
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn import_media_bytes_dedups_and_rejects_bad_ext() {
        let base = std::env::temp_dir().join(format!("sb-media-dedup-{}", std::process::id()));
        let mut lib = Library::open(base.join("lib")).unwrap();

        let first = lib
            .import_media_bytes(png_bytes(), "png", "", "bilibili", "", vec![], vec![])
            .unwrap();
        assert!(first.added);
        let a = &lib.assets()[0];
        assert_eq!(a.name, "untitled");
        assert!(!a.animated);
        assert_eq!((a.width, a.height), (4, 5));

        let again = lib
            .import_media_bytes(png_bytes(), "png", "again.png", "bilibili", "", vec![], vec![])
            .unwrap();
        assert!(!again.added);
        assert_eq!(again.sha, first.sha);
        assert_eq!(lib.assets().len(), 1);

        let err = lib
            .import_media_bytes(b"<html>".to_vec(), "mp4", "x.mp4", "bilibili", "", vec![], vec![])
            .unwrap_err();
        assert!(err.to_string().contains("不支持"), "err = {err}");
        assert!(lib
            .import_media_bytes(Vec::new(), "gif", "e.gif", "bilibili", "", vec![], vec![])
            .is_err());
        assert_eq!(lib.assets().len(), 1, "失败的导入不能留下资产");

        std::fs::remove_dir_all(&base).ok();
    }
}
