/**
 * 跨时区 ZIP 打包回归门禁的被测对象。
 *
 * 它同时从**两个生产入口**导入打包器，不复制任何打包逻辑：门禁要抓的正是"生产代码里那个纪元
 * 常量被改回 UTC 字面量"，而复制一份实现只会让门禁测它自己。
 *
 * 由 `tests/zip-epoch-timezone.test.ts` 用 esbuild 打成临时 ESM 后交给子进程加载。打这一步是
 * 必需的——两个包的源码都用无扩展名相对导入，Node 的 ESM 解析器不接受。
 */
export { packLocalLibraryArchive } from '../../packages/local-library/src/archive-pack';
export {
  packWebPackageZip,
} from '../../packages/web-package/src/zip';
export {
  digestWebPackageBytes,
  verifyWebPackage,
} from '../../packages/web-package/src/verify';
export { ZIP_DOS_EPOCH } from '../../packages/contracts/src/zip';