import * as React from 'react';
import { Provider, Injectable } from '@ali/common-di';
import { ActivatorBar } from './activator-bar.view';
import { BrowserModule, EffectDomain } from '@ali/ide-core-browser';

const pkgJson = require('../../package.json');
@EffectDomain(pkgJson.name)
export class ActivatorBarModule extends BrowserModule {
  providers: Provider[] = [];
  component = ActivatorBar;
}
