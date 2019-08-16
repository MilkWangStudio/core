import { WorkbenchEditorService, EditorCollectionService, ICodeEditor, IResource, ResourceService, IResourceOpenOptions, IDiffEditor, IDiffResource, IEditor, Position, CursorStatus, IEditorOpenType, EditorGroupSplitAction, IEditorGroup, IOpenResourceResult, IEditorGroupState } from '../common';
import { Injectable, Autowired, Injector, INJECTOR_TOKEN } from '@ali/common-di';
import { observable, computed, action, reaction, IReactionDisposer } from 'mobx';
import { CommandService, URI, getLogger, MaybeNull, Deferred, Emitter as EventEmitter, Event, DisposableCollection, WithEventBus, OnEvent, StorageProvider, IStorage, STORAGE_NAMESPACE } from '@ali/ide-core-common';
import { EditorComponentRegistry, IEditorComponent, GridResizeEvent, DragOverPosition, EditorGroupOpenEvent, EditorGroupChangeEvent, EditorSelectionChangeEvent, EditorVisibleChangeEvent, EditorConfigurationChangedEvent, EditorGroupIndexChangedEvent, EditorComponentRenderMode } from './types';
import { IGridEditorGroup, EditorGrid, SplitDirection, IEditorGridState } from './grid/grid.service';
import { makeRandomHexString } from '@ali/ide-core-common/lib/functional';
import { EXPLORER_COMMANDS } from '@ali/ide-core-browser';
import { IWorkspaceService } from '@ali/ide-workspace';

@Injectable()
export class WorkbenchEditorServiceImpl extends WithEventBus implements WorkbenchEditorService {

  @observable.shallow
  editorGroups: EditorGroup[] = [];

  @Autowired(INJECTOR_TOKEN)
  private injector!: Injector;

  @Autowired(CommandService)
  private commands: CommandService;

  @Autowired(IWorkspaceService)
  private workspaceService: IWorkspaceService;

  private readonly _onActiveResourceChange = new EventEmitter<MaybeNull<IResource>>();
  public readonly onActiveResourceChange: Event<MaybeNull<IResource>> = this._onActiveResourceChange.event;

  private readonly _onCursorChange = new EventEmitter<CursorStatus>();
  public readonly onCursorChange: Event<CursorStatus> = this._onCursorChange.event;

  public topGrid: EditorGrid;

  @observable.ref
  private _currentEditorGroup: EditorGroup;

  @Autowired(StorageProvider)
  getStorage: StorageProvider;

  openedResourceState: IStorage;

  private _restoring: boolean = true;

  public contributionsReady = new Deferred();

  private initializing: Promise<any>;

  constructor() {
    super();
    this.initialize();
  }

  setCurrentGroup(editorGroup) {
    if (editorGroup) {
      if (this._currentEditorGroup === editorGroup) {
        return;
      }
      this._currentEditorGroup = editorGroup;
      this._onActiveResourceChange.fire(editorGroup.currentResource);
    }
  }

  createEditorGroup(): EditorGroup {
    const editorGroup = this.injector.get(EditorGroup, [this.generateRandomEditorGroupName()]);
    this.editorGroups.push(editorGroup);
    const currentWatchDisposer = reaction(() => editorGroup.currentResource, () => {
      this._onActiveResourceChange.fire(editorGroup.currentResource);
    });
    editorGroup.onDispose(() => {
      currentWatchDisposer();
    });
    const groupChangeDisposer = reaction(() => editorGroup.getState(), () => {
      this.saveOpenedResourceState();
    });
    editorGroup.onDispose(() => {
      groupChangeDisposer();
    });
    editorGroup.onCurrentEditorCursorChange((e) => {
      if (this._currentEditorGroup === editorGroup) {
        this._onCursorChange.fire(e);
      }
    });
    return editorGroup;
  }

  /**
   * 随机生成一个不重复的editor Group
   */
  private generateRandomEditorGroupName() {
    let name = makeRandomHexString(5);
    while (this.editorGroups.findIndex((g) => g.name === name) !== -1) {
      name = makeRandomHexString(5);
    }
    return name;
  }

  public initialize() {
    if (!this.initializing)  {
      this.initializing = this.doInitialize();
    }
    return this.initializing;
  }

  private async doInitialize() {
    this.openedResourceState = await this.initializeState();
    await this.contributionsReady.promise;
    await this.restoreState();
    this._currentEditorGroup = this.editorGroups[0];
  }

  private async initializeState() {
    const state = await this.getStorage(STORAGE_NAMESPACE.WORKBEACH);
    return state;
  }

  public get currentEditor(): IEditor | null {
    return this.currentEditorGroup.currentEditor;
  }

  public get currentCodeEditor(): ICodeEditor | null {
    return this.currentEditorGroup.currentCodeEditor;
  }

  public get currentEditorGroup(): EditorGroup {
    return this._currentEditorGroup;
  }

  async open(uri: URI, options?: IResourceOpenOptions) {
    await this.initialize();
    this.workspaceService.setMostRecentlyOpenedFile!(uri.toString());
    let group = this.currentEditorGroup;
    if (options && options.groupIndex) {
      if (options.groupIndex >= this.editorGroups.length) {
        return group.open(uri, Object.assign({}, options, {split: EditorGroupSplitAction.Right}));
      } else {
        group = this.editorGroups[options.groupIndex];
      }
    }
    return group.open(uri, options);
  }

  async openUris(uris: URI[]) {
    await this.initialize();
    await this.currentEditorGroup.openUris(uris);
    return ;
  }

  getEditorGroup(name: string): EditorGroup | undefined {
    return this.editorGroups.find((g) => g.name === name);
  }

  @computed
  get currentResource(): MaybeNull<IResource> {
    if (!this.currentEditorGroup) {
      return null;
    }
    return this.currentEditorGroup.currentResource;
  }

  removeGroup(group: EditorGroup) {
    const index = this.editorGroups.findIndex((e) => e === group);
    if (index !== -1) {
      this.editorGroups.splice(index, 1);
      if (this.currentEditorGroup === group) {
        this.setCurrentGroup(this.editorGroups[0]);
      }
      for (let i = index; i < this.editorGroups.length; i++) {
        this.eventBus.fire(new EditorGroupIndexChangedEvent({
          group: this.editorGroups[i],
          index: i,
        }));
      }
    }
  }

  public async saveOpenedResourceState() {
    if (this._restoring) {
      return;
    }
    const state: IEditorGridState = this.topGrid.serialize()!;
    await this.openedResourceState.set('grid', JSON.stringify(state));

  }

  public async restoreState() {
    let state: IEditorGridState = { editorGroup: { uris: [] }};
    console.log(this.openedResourceState.get('grid', JSON.stringify(state)), 'state===>');
    try {
      state = JSON.parse(this.openedResourceState.get('grid', JSON.stringify(state)));
    } catch (e) {
      getLogger().error(e);
    }

    this.topGrid = new EditorGrid();
    this.topGrid.deserialize(state, () => {
      return this.createEditorGroup();
    });
    this._restoring = false;

  }

  async closeAll(uri?: URI) {
    for (const group of this.editorGroups) {
      if (uri) {
        await group.close(uri);
      } else {
        await group.closeAll();
      }
    }
  }

}

export interface IEditorCurrentState {

  currentResource: IResource;

  currentOpenType: IEditorOpenType;

}
/**
 * Editor Group是一个可视的编辑区域
 * 它由tab，editor，diff-editor，富组件container组成
 */
@Injectable({ multiple: true })
export class EditorGroup extends WithEventBus implements IGridEditorGroup {

  @Autowired()
  collectionService!: EditorCollectionService;

  @Autowired()
  resourceService: ResourceService;

  @Autowired()
  editorComponentRegistry: EditorComponentRegistry;

  @Autowired(WorkbenchEditorService)
  workbenchEditorService: WorkbenchEditorServiceImpl;

  @Autowired(CommandService)
  private commands: CommandService;

  codeEditor!: ICodeEditor;

  diffEditor!: IDiffEditor;

  private openingPromise: Map<string, Promise<IOpenResourceResult> > = new Map();

  /**
   * 当前打开的所有resource
   */
  @observable.shallow resources: IResource[] = [];

  @observable.ref _currentState: IEditorCurrentState | null = null;
  /**
   * 当前resource的打开方式
   */
  private cachedResourcesActiveOpenTypes = new Map<string, IEditorOpenType>();

  private cachedResourcesOpenTypes = new Map<string, IEditorOpenType[]>();

  @observable.ref availableOpenTypes: IEditorOpenType[] = [];

  @observable.shallow activeComponents = new Map<IEditorComponent, IResource[]>();

  public grid: EditorGrid;

  private codeEditorReady: Deferred<any> = new Deferred<any>();

  private diffEditorReady: Deferred<any> = new Deferred<any>();

  private readonly toDispose: monaco.IDisposable[] = [];

  // 当前为EditorComponent，且monaco光标变化时触发
  private _onCurrentEditorCursorChange = new EventEmitter<CursorStatus>();
  public onCurrentEditorCursorChange = this._onCurrentEditorCursorChange.event;

  constructor(public readonly name: string) {
    super();
    this.eventBus.on(GridResizeEvent, (e: GridResizeEvent) => {
      if (e.payload.gridId === this.grid.uid) {
        this.layoutEditors();
      }
    });
    // TODO listen Main layout resize Event
  }

  layoutEditors() {
    if (this.codeEditor) {
      this.codeEditor.layout();
    }
    if (this.diffEditor) {
      this.diffEditor.layout();
    }
  }

  @computed
  get currentState() {
    return this._currentState;
  }

  set currentState(value: IEditorCurrentState | null) {
    const oldResource = this.currentResource;
    const oldOpenType = this.currentOpenType;
    this._currentState = value;
    this.eventBus.fire(new EditorGroupChangeEvent({
      group: this,
      newOpenType: this.currentOpenType,
      newResource: this.currentResource,
      oldOpenType,
      oldResource,
    }));
  }

  get index(): number {
    return this.workbenchEditorService.editorGroups.indexOf(this);
  }

  get currentEditor(): IEditor | null {
    if (this.currentOpenType) {
      if (this.currentOpenType.type === 'code') {
        return this.codeEditor;
      } else if (this.currentOpenType.type === 'diff') {
        return this.diffEditor.modifiedEditor;
      } else {
        return null;
      }
    } else {
      return null;
    }
  }

  get currentCodeEditor(): ICodeEditor | null {
    if (this.currentOpenType) {
      if (this.currentOpenType.type === 'code') {
        return this.codeEditor;
      } else {
        return null;
      }
    } else {
      return null;
    }
  }

  async createEditor(dom: HTMLElement) {
    this.codeEditor = await this.collectionService.createCodeEditor(dom);
    this.codeEditor.layout();
    this.toDispose.push(this.codeEditor.onCursorPositionChanged((e) => {
      this._onCurrentEditorCursorChange.fire(e);
    }));
    this.toDispose.push(this.codeEditor.onSelectionsChanged((e) => {
      if (this.currentOpenType && this.currentOpenType.type === 'code') {
        this.eventBus.fire(new EditorSelectionChangeEvent({
          group: this,
          resource: this.currentResource!,
          selections: e.selections,
          source: e.source,
        }));
      }
    }));
    this.toDispose.push(this.codeEditor.onVisibleRangesChanged((e) => {
      if (this.currentOpenType && this.currentOpenType.type === 'code') {
        this.eventBus.fire(new EditorVisibleChangeEvent({
          group: this,
          resource: this.currentResource!,
          visibleRanges: e,
        }));
      }
    }));
    this.toDispose.push(this.codeEditor.onConfigurationChanged((e) => {
      if (this.currentOpenType && this.currentOpenType.type === 'code') {
        this.eventBus.fire(new EditorConfigurationChangedEvent({
          group: this,
          resource: this.currentResource!,
        }));
      }
    }));
    this.codeEditorReady.resolve();
  }

  async createDiffEditor(dom: HTMLElement) {
    this.diffEditor = await this.collectionService.createDiffEditor(dom);
    this.diffEditor.layout();
    this.toDispose.push(this.diffEditor.modifiedEditor.onSelectionsChanged((e) => {
      if (this.currentOpenType && this.currentOpenType.type === 'diff') {
        this.eventBus.fire(new EditorSelectionChangeEvent({
          group: this,
          resource: this.currentResource!,
          selections: e.selections,
          source: e.source,
        }));
      }
    }));
    this.toDispose.push(this.diffEditor.modifiedEditor.onVisibleRangesChanged((e) => {
      if (this.currentOpenType && this.currentOpenType.type === 'diff') {
        this.eventBus.fire(new EditorVisibleChangeEvent({
          group: this,
          resource: this.currentResource!,
          visibleRanges: e,
        }));
      }
    }));
    this.toDispose.push(this.diffEditor.modifiedEditor.onConfigurationChanged((e) => {
      if (this.currentOpenType && this.currentOpenType.type === 'diff') {
        this.eventBus.fire(new EditorConfigurationChangedEvent({
          group: this,
          resource: this.currentResource!,
        }));
      }
    }));
    this.diffEditorReady.resolve();
  }

  async split(action: EditorGroupSplitAction, uri: URI, options?: IResourceOpenOptions) {
    const editorGroup = this.workbenchEditorService.createEditorGroup();
    const direction = ( action === EditorGroupSplitAction.Left ||  action === EditorGroupSplitAction.Right ) ? SplitDirection.Horizontal : SplitDirection.Vertical;
    const before = ( action === EditorGroupSplitAction.Left ||  action === EditorGroupSplitAction.Top ) ? true : false;
    this.grid.split(direction, editorGroup, before);
    return editorGroup.open(uri, options);
  }

  async open(uri: URI, options?: IResourceOpenOptions): Promise<IOpenResourceResult> {
    if (options && options.split) {
      return this.split(options.split, uri, Object.assign({}, options, { split: undefined}));
    }
    if (!this.openingPromise.has(uri.toString())) {
      const promise = this.doOpen(uri, options).finally(() => {
        this.openingPromise.delete(uri.toString());
      });
      this.openingPromise.set(uri.toString(), promise);
    }
    return this.openingPromise.get(uri.toString())!;
  }

  @action.bound
  async doOpen(uri: URI, options?: IResourceOpenOptions, onlyAddTab: boolean = false): Promise<{ group: IEditorGroup, resource: IResource} | false> {
    if (uri.scheme === 'http' || uri.scheme === 'https') {
      window.open(uri.toString());
      return false;
    }
    try {
      if (!options || options && !options.disableNavigate) {
        this.commands.executeCommand( EXPLORER_COMMANDS.LOCATION.id, uri);
      }
      const oldResource = this.currentResource;
      const oldOpenType = this.currentOpenType;
      if (this.currentResource && this.currentResource.uri === uri) {
         // 就是当前打开的resource
         return {
          group: this,
          resource: this.currentResource,
        };
      } else {
        let resource: IResource | null | undefined = this.resources.find((r) => r.uri.toString() === uri.toString());
        if (!resource) {
          // open new resource
          resource = await this.resourceService.getResource(uri);
          if (!resource) {
            throw new Error('This uri cannot be opened!: ' + uri);
          }
          if (options && options.index !== undefined && options.index < this.resources.length) {
            this.resources.splice(options.index, 0, resource);
          } else {
            this.resources.push(resource);
          }
        }
        if (onlyAddTab) {
          return false;
        }
        await this.displayResourceComponent(resource, options);
        this.eventBus.fire(new EditorGroupOpenEvent({
          group: this,
          resource,
        }));
        return {
          group: this,
          resource,
        };
      }
    } catch (e) {
      getLogger().error(e);
      return false;
      // todo 给用户显示error
    }
  }

  async openUris(uris: URI[], options?: IResourceOpenOptions): Promise<void> {
    for (const uri of uris) {
      await this.open(uri);
    }
  }

  private async displayResourceComponent(resource: IResource, options: IResourceOpenOptions = {}) {
    const result = await this.resolveOpenType(resource, options );
    if (result) {
      const { activeOpenType, openTypes } = result;

      this.availableOpenTypes = openTypes;

      if (activeOpenType.type === 'code') {
        await this.codeEditorReady.promise;
        await this.codeEditor.open(resource.uri, options.range);
        if (options.preserveFocus) {
          this.codeEditor.focus();
        }

      } else if (activeOpenType.type === 'diff') {
        const diffResource = resource as IDiffResource;
        await this.diffEditorReady.promise;
        await this.diffEditor.compare(diffResource.metadata!.original, diffResource.metadata!.modified);

      } else if (activeOpenType.type === 'component') {
        const component = this.editorComponentRegistry.getEditorComponent(activeOpenType.componentId as string);
        if (!component) {
          throw new Error('Cannot find Editor Component with id: ' + activeOpenType.componentId);
        } else {
          if (component.renderMode === EditorComponentRenderMode.ONE_PER_RESOURCE ) {
            const openedResources = this.activeComponents.get(component) || [];
            const index = openedResources.findIndex((r) => r.uri.toString() === resource.uri.toString());
            if (index === -1 ) {
              openedResources.push(resource);
            }
            this.activeComponents.set(component, openedResources);
          } else if (component.renderMode === EditorComponentRenderMode.ONE_PER_GROUP ) {
            this.activeComponents.set(component, [resource]);
          } else if (component.renderMode === EditorComponentRenderMode.ONE_PER_WORKBENCH ) {
            const promises: Promise<any>[] = [];
            this.workbenchEditorService.editorGroups.forEach((g) => {
              if (g === this) {
                return;
              }
              const r = g.resources.find((r) => r.uri.isEqual(resource.uri));
              if (r) {
                promises.push(g.close(r.uri));
              }
            });
            await Promise.all(promises).catch(getLogger().error);
            this.activeComponents.set(component, [resource]);
          }
        }
        // 打开非编辑器的component时需要手动触发
        this._onCurrentEditorCursorChange.fire({
          position: null,
          selectionLength: 0,
        });
      } else {
        return; // other type not handled
      }
      this.currentState = {
        currentResource: resource,
        currentOpenType: activeOpenType,
      };
      this.cachedResourcesActiveOpenTypes.set(resource.uri.toString(), activeOpenType);
      getLogger().log(this.resources);
    }
  }

  private async resolveOpenType(resource: IResource, options: IResourceOpenOptions): Promise<{activeOpenType: IEditorOpenType, openTypes: IEditorOpenType[] } | null> {
    const openTypes = this.cachedResourcesOpenTypes.get(resource.uri.toString()) || await this.editorComponentRegistry.resolveEditorComponent(resource);
    const activeOpenType = findSuitableOpenType(openTypes, this.cachedResourcesActiveOpenTypes.get(resource.uri.toString()), options.forceOpenType);
    this.cachedResourcesOpenTypes.set(resource.uri.toString(), openTypes);
    return { activeOpenType, openTypes };
  }

  public async close(uri: URI) {
    const index = this.resources.findIndex((r) => r.uri.toString() === uri.toString());
    if (index !== -1) {
      const resource = this.resources[index];
      if (!await this.shouldClose(resource)) {
        return;
      }
      this.resources.splice(index, 1);
      // 默认打开去除当前关闭目标uri后相同位置的uri, 如果没有，则一直往前找到第一个可用的uri
      if ( resource === this.currentResource) {
        let i = index;
        while (i > 0 && !this.resources[i]) {
          i -- ;
        }
        if (this.resources[i]) {
          this.open(this.resources[i].uri);
        } else {
          this.currentState = null;
        }
      }
      for (const resources of this.activeComponents.values()) {
        const i = resources.indexOf(resource);
        if ( i !== -1) {
          resources.splice(i, 1);
        }
      }
    }
    if (this.resources.length === 0) {
      if (this.grid.parent) {
        // 当前不是最后一个 editor Group
        this.dispose();
      }

    }
  }

  private async shouldClose(resource: IResource): Promise<boolean> {
    if (!await this.resourceService.shouldCloseResource(resource, this.workbenchEditorService.editorGroups.map((group) => group.resources))) {
      return false;
    }
    return true;
  }

  /**
   * 关闭全部
   */
  @action.bound
  async closeAll() {
    for (const resource of this.resources) {
      if (!await this.shouldClose(resource)) {
        return;
      }
    }
    this.currentState = null;
    this.resources.splice(0, this.resources.length);
    this.activeComponents.clear();
    this.dispose();
  }

  /**
   * 关闭向右的tab
   * @param uri
   */
  @action.bound
  async closeToRight(uri: URI) {
    const index = this.resources.findIndex((r) => r.uri.toString() === uri.toString());
    if (index !== -1) {
      const resourcesToClose = this.resources.slice(index + 1);
      for (const resource of resourcesToClose) {
        if (!await this.shouldClose(resource)) {
          return;
        }
      }
      this.resources.splice(index + 1);
      for (const resource of resourcesToClose) {
        for (const resources of this.activeComponents.values()) {
          const i = resources.indexOf(resource);
          if ( i !== -1) {
            resources.splice(i, 1);
          }
        }
      }
      this.open(uri);
    }
  }

  @action.bound
  async closeOthers(uri: URI) {
    const index = this.resources.findIndex((r) => r.uri.toString() === uri.toString());
    if (index !== -1) {
      const resourcesToClose = this.resources.filter((v, i) => i !== index );
      for (const resource of resourcesToClose) {
        if (!await this.shouldClose(resource)) {
          return;
        }
      }
      this.resources = [this.resources[index]];
      for (const resource of resourcesToClose) {
        for (const resources of this.activeComponents.values()) {
          const i = resources.indexOf(resource);
          if ( i !== -1) {
            resources.splice(i, 1);
          }
        }
      }
      this.open(uri);
    }
  }

  /**
   * 当前打开的resource
   */
  get currentResource(): MaybeNull<IResource> {
    return this.currentState && this.currentState.currentResource;
  }

  @computed
  get currentOpenType(): MaybeNull<IEditorOpenType> {
    return this.currentState && this.currentState.currentOpenType;
  }

  async changeOpenType(type: IEditorOpenType) {
    if (!this.currentResource) {
      return;
    }
    if (openTypeSimilar(type, this.currentOpenType!)) {
      return;
    }
    await this.displayResourceComponent(this.currentResource!, {forceOpenType: type});
  }

  /**
   * 拖拽drop方法
   */
  @action.bound
  public async dropUri(uri: URI, position: DragOverPosition, sourceGroup?: EditorGroup , targetResource?: IResource) {
    if (position !== DragOverPosition.CENTER) {
      await this.split(getSplitActionFromDragDrop(position), uri);
    } else {
      // 扔在本体或者tab上
      if (!targetResource) {
        await this.open(uri);
      } else {
        const targetIndex = this.resources.indexOf(targetResource);
        if (targetIndex === -1) {
          await this.open(uri);
        } else {
          const sourceIndex = this.resources.findIndex((resource) => resource.uri.toString() === uri.toString());
          if (sourceIndex === -1) {
            await this.open(uri, {
              index: targetIndex,
            });
          } else {
            // just move
            const sourceResource = this.resources[sourceIndex];
            if (sourceIndex > targetIndex) {
              this.resources.splice(sourceIndex, 1);
              this.resources.splice(targetIndex, 0, sourceResource);
              await this.open(uri);
            } else if (sourceIndex < targetIndex) {
              this.resources.splice(targetIndex + 1, 0 , sourceResource);
              this.resources.splice(sourceIndex, 1);
              await this.open(uri);
            }
          }
        }
      }
    }

    if (sourceGroup && sourceGroup !== this) {
      await sourceGroup.close(uri);
    }

  }

  gainFocus() {
    this.workbenchEditorService.setCurrentGroup(this);
  }

  focus() {
    this.gainFocus();
    if (this.currentOpenType && this.currentOpenType.type === 'code') {
      this.codeEditor.focus();
    }
    if (this.currentOpenType && this.currentOpenType.type === 'diff') {
      this.diffEditor.focus();
    }
  }

  dispose() {
    this.grid.dispose();
    this.workbenchEditorService.removeGroup(this);
    super.dispose();
    this.toDispose.forEach((disposable) => disposable.dispose());
  }

  getState(): IEditorGroupState {
    return {
      uris: this.resources.map((r) => r.uri.toString()),
      current: this.currentResource ? this.currentResource.uri.toString() : undefined,
    };
  }

  isCodeEditorMode() {
    return this.currentOpenType && this.currentOpenType.type === 'code';
  }

  isDiffEditorMode() {
    return this.currentOpenType && this.currentOpenType.type === 'diff';
  }

  isComponentMode() {
    return  this.currentOpenType && this.currentOpenType.type === 'component';
  }

  async restoreState(state: IEditorGroupState) {
    for (const uri of state.uris) {
      await this.doOpen(new URI(uri), {}, true);
    }
    if (state.current) {
      await this.open(new URI(state.current));
    } else {
      if (state.uris.length > 0) {
        this.open(new URI(state.uris[state.uris.length - 1]!));
      }
    }
  }
}

function findSuitableOpenType(currentAvailable: IEditorOpenType[], prev: IEditorOpenType | undefined, forceOpenType?: IEditorOpenType) {
  if (forceOpenType) {
    return currentAvailable.find((p) => {
      return p === forceOpenType;
    }) || currentAvailable[0];
  } else if (prev) {
    return currentAvailable.find((p) => {
      return openTypeSimilar(p, prev);
    }) || currentAvailable[0];
  }
  return currentAvailable[0];
}

function openTypeSimilar(a: IEditorOpenType, b: IEditorOpenType) {
  return a.type === b.type && (a.type !== 'component' || a.componentId === b.componentId);
}

function getSplitActionFromDragDrop(position: DragOverPosition): EditorGroupSplitAction {
  return {
    [DragOverPosition.LEFT]: EditorGroupSplitAction.Left,
    [DragOverPosition.RIGHT]: EditorGroupSplitAction.Right,
    [DragOverPosition.BOTTOM]: EditorGroupSplitAction.Bottom,
    [DragOverPosition.TOP]: EditorGroupSplitAction.Top,
  }[position];
}
