import { observable } from 'mobx';
import { Injectable, Autowired } from '@ali/common-di';
import { Disposable } from '@ali/ide-core-browser';

import { CommandService } from '@ali/ide-core-common';
import { ComponentInfo } from '@ali/ide-core-browser/lib/layout';

@Injectable()
export class ActivatorBarService extends Disposable {

  @observable
  public leftPanels: ComponentInfo[] = [];

  @observable
  public rightPanels: ComponentInfo[] = [];

  @Autowired(CommandService)
  private commandService!: CommandService;
  constructor() {
      super();
  }
  hidePanel = (side) => {
    this.commandService.executeCommand(`main-layout.${side}-panel.hide`);
  }
  showPanel = (side) => {
    this.commandService.executeCommand(`main-layout.${side}-panel.show`);
  }

  append = (componentInfo: ComponentInfo, side: Side) => {
    if (side === 'right') {
      console.log(componentInfo);
      this.rightPanels.push(componentInfo);
    } else if (side === 'left') {
      this.leftPanels.push(componentInfo);
    } else {
      console.warn('暂不支持的位置！' + side);
    }
  }

}

export type Side = 'left' | 'right';
