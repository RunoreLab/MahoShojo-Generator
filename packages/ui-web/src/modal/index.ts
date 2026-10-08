// 共源模态框原语（D5.0e 从 apps/web/components/shared 抽取）。
export {
  BaseModal,
  getBaseModalLayoutClassNames,
  useBaseModalAccessibility,
  BASE_MODAL_BODY_LAYOUT_CLASS_NAME,
  BASE_MODAL_FOOTER_LAYOUT_CLASS_NAME,
  BASE_MODAL_HEADER_LAYOUT_CLASS_NAME,
  BASE_MODAL_PANEL_LAYOUT_CLASS_NAME,
  BASE_MODAL_ROOT_LAYOUT_CLASS_NAME,
} from './BaseModal';
export type { BaseModalLayoutClassNameOptions } from './BaseModal';
// 统一 Escape 层级登记（DESK-PARITY-007）：层与兜底共用一个分发器。
export {
  isTopmostFocusTrapLayer,
  popEscapeLayer,
  pushEscapeLayer,
  useEscapeFallback,
  useEscapeLayer,
} from './escape-stack';
export type {
  EscapeLayerHandler,
  EscapeLayerRegistration,
  UseEscapeLayerOptions,
} from './escape-stack';
export { ModalTabs, modalTabIds } from './ModalTabs';
export type { ModalTabItem, ModalTabsProps } from './ModalTabs';
export { ImagePreviewModal } from './ImagePreviewModal';
