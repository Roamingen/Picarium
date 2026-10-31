fn main() {
    // 前端资源是编译期嵌进二进制的：这里显式声明依赖，
    // 否则只改 ui/ 下的文件时 cargo 会认为"无事发生"，跑出来的还是旧界面。
    println!("cargo:rerun-if-changed=ui");
    tauri_build::build()
}
