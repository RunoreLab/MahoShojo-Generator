/**
 * Browser-only presentation adapters.
 *
 * Keep DOM-dependent materialization off the package root so Node/Worker consumers
 * can depend on @mahoshojo/web-package without loading browser ambient types.
 */
export {
  canRenderBuiltinWebPackageSrcdoc,
  renderBuiltinWebPackageSrcdoc,
} from './builtin-adapter';

export { renderWebPackageInstance, WebPackageRenderError, type WebPackagePresentation } from './render';
