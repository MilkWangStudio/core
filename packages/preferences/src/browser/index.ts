import * as React from 'react';
import { Provider, Injector, Injectable } from '@ali/common-di';
import { BrowserModule, EffectDomain } from '@ali/ide-core-browser';
import { PreferenceContribution } from './preference-contribution';
import { FoldersPreferencesProvider } from './folders-preferences-provider';
import { WorkspacePreferenceProvider } from './workspace-preference-provider';
import { UserPreferenceProvider } from './user-preference-provider';
import { preferenceScopeProviderTokenMap, PreferenceScope, PreferenceConfigurations } from '@ali/ide-core-browser/lib/preferences';
import { FolderPreferenceProviderFactory, FolderPreferenceProviderOptions, FolderPreferenceProvider } from './folder-preference-provider';
import { WorkspaceFilePreferenceProviderFactory, WorkspaceFilePreferenceProviderOptions, WorkspaceFilePreferenceProvider } from './workspace-file-preference-provider';

@Injectable()
export class PreferencesModule extends BrowserModule {
  providers: Provider[] = [
    {
      token: preferenceScopeProviderTokenMap[PreferenceScope.Folder],
      useClass: FoldersPreferencesProvider,
    },
    {
      token: preferenceScopeProviderTokenMap[PreferenceScope.Workspace],
      useClass: WorkspacePreferenceProvider,
    },
    {
      token: preferenceScopeProviderTokenMap[PreferenceScope.User],
      useClass: UserPreferenceProvider,
    },
    PreferenceContribution,
  ];

  preferences = injectPreferenceProviders;
}

export function injectFolderPreferenceProvider(inject: Injector): void {
  inject.addProviders({
    token: FolderPreferenceProviderFactory,
    useFactory: () => {
      return (options: FolderPreferenceProviderOptions) => {
        const configurations = inject.get(PreferenceConfigurations);
        const sectionName = configurations.getName(options.configUri);
        const child = inject.createChild([
          {
            token: FolderPreferenceProviderOptions,
            useValue: options,
          },
        ], {
          dropdownForTag: true,
          tag: sectionName,
        });
        // 当传入为配置文件时，如settings.json, 获取Setting
        if (configurations.isConfigUri(options.configUri)) {
          child.addProviders({
            token: FolderPreferenceProvider,
            useClass: FolderPreferenceProvider,
          });
          return child.get(FolderPreferenceProvider);
        }
        // 当传入为其他文件时，如launch.json
        // 需设置对应的FolderPreferenceProvider 及其对应的 FolderPreferenceProviderOptions 依赖
        return child.get(FolderPreferenceProvider, { tag: sectionName });

      };
    },
  });
}

export function injectWorkspaceFilePreferenceProvider(inject: Injector): void {
  inject.addProviders({
    token: WorkspaceFilePreferenceProviderFactory,
    useFactory: () => {
      return (options: WorkspaceFilePreferenceProviderOptions) => {
        inject.addProviders({
          token: WorkspaceFilePreferenceProviderOptions,
          useValue: options,
        });
        inject.addProviders({
          token: WorkspaceFilePreferenceProvider,
          useClass: WorkspaceFilePreferenceProvider,
        });
        return inject.get(WorkspaceFilePreferenceProvider);
      };
    },
  });
}

export function injectPreferenceProviders(inject: Injector): void {
  injectFolderPreferenceProvider(inject);
  injectWorkspaceFilePreferenceProvider(inject);
}
