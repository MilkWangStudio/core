import clsx from 'classnames';
import React from 'react';

import { ComponentRegistryInfo, useInjectable, IEventBus, ResizeEvent } from '@opensumi/ide-core-browser';
import { PanelContext } from '@opensumi/ide-core-browser/lib/components';
import { Layout } from '@opensumi/ide-core-browser/lib/components/layout/layout';
import { VIEW_CONTAINERS } from '@opensumi/ide-core-browser/lib/layout/view-id';

import { RightTabbarRenderer, LeftTabbarRenderer, BottomTabbarRenderer } from './bar.view';
import { RightTabPanelRenderer, LeftTabPanelRenderer, BottomTabPanelRenderer } from './panel.view';
import styles from './styles.module.less';
import { TabbarServiceFactory, TabbarService } from './tabbar.service';

export const TabbarConfig = React.createContext<{
  side: string;
  direction: Layout.direction;
  fullSize: number;
}>({
  side: 'left',
  direction: 'left-to-right',
  fullSize: 0,
});

export const TabRendererBase: React.FC<{
  side: string;
  id?: string;
  className?: string;
  components: ComponentRegistryInfo[];
  direction?: Layout.direction;
  TabbarView: React.FC;
  TabpanelView: React.FC;
  // @deprecated
  noAccordion?: boolean;
}> = ({ id, className, components, direction = 'left-to-right', TabbarView, side, TabpanelView }) => {
  const tabbarService: TabbarService = useInjectable(TabbarServiceFactory)(side);
  const eventBus = useInjectable<IEventBus>(IEventBus);
  const resizeHandle = React.useContext(PanelContext);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [fullSize, setFullSize] = React.useState(0);
  React.useLayoutEffect(() => {
    tabbarService.registerResizeHandle(resizeHandle);
    components.forEach((component) => {
      tabbarService.registerContainer(component.options!.containerId, component);
    });
    tabbarService.updatePanelVisibility();
    tabbarService.viewReady.resolve();
  }, [resizeHandle, components]);
  React.useEffect(() => {
    if (rootRef.current) {
      setFullSize(rootRef.current[Layout.getDomSizeProperty(direction)]);
      let lastFrame: number | null;
      eventBus.on(ResizeEvent, (e) => {
        if (e.payload.slotLocation === side) {
          if (lastFrame) {
            window.cancelAnimationFrame(lastFrame);
          }
          lastFrame = window.requestAnimationFrame(() => {
            setFullSize(rootRef.current![Layout.getDomSizeProperty(direction)]);
          });
        }
      });
    }
  }, []);

  return (
    <div
      ref={rootRef}
      id={id}
      className={clsx(styles.tab_container, className)}
      style={{ flexDirection: Layout.getFlexDirection(direction) }}
    >
      <TabbarConfig.Provider value={{ side, direction, fullSize }}>
        <TabbarView />
        <TabpanelView />
      </TabbarConfig.Provider>
    </div>
  );
};

export const RightTabRenderer = ({
  className,
  components,
}: {
  className: string;
  components: ComponentRegistryInfo[];
}) => (
  <TabRendererBase
    side='right'
    direction='right-to-left'
    id={VIEW_CONTAINERS.RIGHT_TABBAR}
    className={clsx(className, 'right-slot')}
    components={components}
    TabbarView={RightTabbarRenderer}
    TabpanelView={RightTabPanelRenderer}
  />
);

export const LeftTabRenderer = ({
  className,
  components,
}: {
  className: string;
  components: ComponentRegistryInfo[];
}) => (
  <TabRendererBase
    side='left'
    direction='left-to-right'
    id={VIEW_CONTAINERS.LEFT_TABBAR_PANEL}
    className={clsx(className, 'left-slot')}
    components={components}
    TabbarView={LeftTabbarRenderer}
    TabpanelView={LeftTabPanelRenderer}
  />
);

export const BottomTabRenderer = ({
  className,
  components,
}: {
  className: string;
  components: ComponentRegistryInfo[];
}) => (
  <TabRendererBase
    side='bottom'
    id={VIEW_CONTAINERS.BOTTOM_TABBAR_PANEL}
    direction='bottom-to-top'
    className={clsx(className, 'bottom-slot')}
    components={components}
    TabbarView={BottomTabbarRenderer}
    TabpanelView={BottomTabPanelRenderer}
    noAccordion={true}
  />
);
