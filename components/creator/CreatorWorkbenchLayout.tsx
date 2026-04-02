type CreatorWorkbenchLayoutMode = 'desktop' | 'mobile';

type CreatorWorkbenchLayoutProps = {
  layoutMode: CreatorWorkbenchLayoutMode;
  sidebar: React.ReactNode;
  main: React.ReactNode;
};

export function CreatorWorkbenchLayout({
  layoutMode,
  sidebar,
  main,
}: CreatorWorkbenchLayoutProps) {
  return (
    <div
      className="creator-workbench-shell mx-auto w-full px-4 pb-8 pt-6 sm:px-6 lg:max-w-[1200px] lg:px-6 xl:max-w-[1360px] xl:px-8 2xl:max-w-[1440px]"
      data-layout-mode={layoutMode}
    >
      {layoutMode === 'mobile' ? (
        <div className="creator-workbench-mobile space-y-4">
          <div className="creator-workbench-mobile-panels">{sidebar}</div>
          <div className="creator-workbench-main">{main}</div>
        </div>
      ) : (
        <div className="creator-workbench-grid grid gap-5 lg:grid-cols-[minmax(320px,340px)_minmax(0,1fr)] xl:grid-cols-[minmax(360px,400px)_minmax(0,1fr)]">
          <aside className="creator-workbench-sidebar min-w-0">{sidebar}</aside>
          <main className="creator-workbench-main min-w-0">{main}</main>
        </div>
      )}
    </div>
  );
}
