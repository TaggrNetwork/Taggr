import * as React from "react";
import {HeadBar} from "./common";
import {Content} from "./content";
import template from '../../../WHITEPAPER.md';


export const Whitepaper = () => {
    let value = template.match(/\$([a-zA-Z_]+)/g).reduce((acc, e) => {
        let key = e.slice(1);
        return acc.replace(e, backendCache.config[key]);
    }, template);
    return <>
        <HeadBar title="White Paper" shareLink="whitepaper" />
        <Content classNameArg="spaced" value={value} />
    </>;
}
