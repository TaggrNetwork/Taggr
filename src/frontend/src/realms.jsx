import * as React from "react";
import {PostFeed} from "./post_feed";
import {loadFile} from "./form";
import {bigScreen, BurgerButton, ButtonWithLoading, HeadBar, Loading, NotFound, realmColors, RealmRibbon, setTitle, userList, } from "./common";
import { Content } from './content';
import {Edit, Close} from "./icons";
import {themes} from "./theme";

export const RealmForm = ({existingName}) => {
    const editing = !!existingName;
    const users = window.backendCache.users;
    const name2Id = Object.keys(users).reduce((acc, id) => {
        acc[users[id]] = id;
        return acc;
    }, {});
    const userId = api._user.id;

    const [name, setName] = React.useState("");
    const [logo, setLogo] = React.useState("");
    const [labelColor, setLabelColor] = React.useState("");
    const [description, setDescription] = React.useState("");
    const [theme, setTheme] = React.useState(null);
    const [controllersString, setControllersString] = React.useState(users[userId]);
    const [controllers, setControllers] = React.useState([userId]);

    const loadRealm = async () => {
        let result = await api.query("realm", existingName);
        if ("Err" in result) {
            alert(`Error: ${result.Err}`);
            return;
        }
        const realm = result.Ok;
        setName(existingName);
        setDescription(realm.description);
        setControllers(realm.controllers);
        if (realm.theme) setTheme(JSON.parse(realm.theme));
        setLabelColor(realm.label_color || "#ffffff");
        setControllersString(realm.controllers.map(id => users[id]).join(", "));
    };
    React.useEffect(() => { if (editing) loadRealm() }, []);

    const valid = name && description && controllers.length > 0;
    return <div className="spaced">
        <h2 className="vcentered">
            {logo && <img alt="Logo" className="right_spaced" style={{ maxWidth: "70px"}} src={`data:image/png;base64, ${logo}`} />}
            <span className="max_width_col">{editing ? "EDIT" : "CREATE"} REALM</span>
        </h2>
        <div className="column_container">
            {editing && <div className="column_container bottom_spaced monospace">
                <div className="bottom_half_spaced">LOGO ({`${backendCache.config.max_realm_logo_len / 1024}`}KB MAX, resize <a href="https://imageresizer.com">here</a>)</div>
                <input type="file" onChange={async ev => {
                    const file = (ev.dataTransfer || ev.target).files[0];
                    const content = new Uint8Array(await loadFile(file));
                    const actualSize = content.byteLength, expectedSize = backendCache.config.max_realm_logo_len;
                    if (content.byteLength > backendCache.config.max_realm_logo_len) {
                        alert(`Logo size must be below ${Math.ceil(expectedSize/1024)}KB, while yours has ${Math.ceil(actualSize/1024)}KB.`);
                        return;
                    }
                    setLogo(btoa(String.fromCharCode.apply(null, new Uint8Array(content))));
                }} />
            </div>}
            {!editing && <div className="column_container bottom_spaced monospace">
                <div className="bottom_half_spaced">REALM NAME
                    {name.length > backendCache.config.max_realm_name && 
                        <span>&nbsp;[⚠️ MUST BE {backendCache.config.max_realm_name} CHARACTERS OR LESS!]</span>}
                </div>
                <input className="monospace" placeholder="alphanumeric" type="text" value={name}
                    onChange={event => {
                        const name = event.target.value.toUpperCase();
                        setName(name);
                    }} />
            </div>}
            <div className="bottom_spaced monospace" style={{position: "relative"}}>
                LABEL COLOR<br />
                <input type="color" value={labelColor} onChange={ev => setLabelColor(ev.target.value)} />
                <RealmRibbon col={labelColor} name={name} />
            </div>
            <div className="column_container bottom_spaced monospace">
                <div className="bottom_half_spaced">DESCRIPTION</div>
                <textarea rows={10} value={description}
                    onChange={event => setDescription(event.target.value)}></textarea>
            </div>
            <div className="framed bottom_spaced">
                <Content value={description} preview={true} classNameArg="bottom_spaced" />
            </div>
            <div className="column_container bottom_spaced monospace">
                <div className="bottom_half_spaced">REALM CONTROLLERS (COMMA-SEPARATED)</div>
                <input className="monospace" type="text"
                    value={controllersString} onChange={event => {
                        const input = event.target.value;
                        const ids = input.split(",")
                            .map(id => name2Id[id.replace("@", "").trim()])
                            .filter(Boolean);
                        setControllersString(input);
                        setControllers(ids);
                    }} />
            </div>
            {controllers.length > 0 &&
            <div className="column_container bottom_spaced monospace">
                <div className="bottom_half_spaced">VALID CONTROLLERS: {userList(controllers)}</div>
            </div>}
            <h2>Color Theme</h2>
            <div className="vcentered">
                <input type="checkbox" checked={!!theme} onChange={() => setTheme(theme ? null : themes.classic)} id="own_theme" />
                <label className="left_half_spaced" htmlFor="own_theme">Use own theme</label>
            </div>
            {theme && <div className="dynamic_table monospace vertically_spaced">
                <div className="db_cell">
                    TEXT
                    <input type="color" value={theme.text} onChange={ev => setTheme({...theme, text: ev.target.value })} />
                </div>
                <div className="db_cell">
                    BACKGROUND
                    <input type="color" value={theme.background} onChange={ev => setTheme({...theme, background: ev.target.value })} />
                </div>
                <div className="db_cell">
                    CODE & DIGITS
                    <input type="color" value={theme.code} onChange={ev => setTheme({...theme, code: ev.target.value })} />
                </div>
                <div className="db_cell">
                    LINK
                    <input type="color" value={theme.clickable} onChange={ev => setTheme({...theme, clickable: ev.target.value })} />
                </div>
                <div className="db_cell">
                    ACCENT
                    <input type="color" value={theme.accent} onChange={ev => setTheme({...theme, accent: ev.target.value })} />
                </div>
            </div>}

            <br />
            <hr />
            <br />

            <ButtonWithLoading classNameArg={valid ? "active" : "inactive"} onClick={async () => {
                if (!valid) return;
                const response = await api.call(editing ? "edit_realm" : "create_realm",
                    name, logo, labelColor, theme ? JSON.stringify(theme) : "", description, controllers.map(id => parseInt(id)));
                if ("Err" in response) {
                    alert(`Error: ${response.Err}`);
                    return;
                }
                if (!editing) {
                    await api.call("toggle_realm_membership", name);
                };
                await Promise.all([window.reloadCache(), api._reloadUser()]);
                if (!editing) {
                    location.href = `#/realm/${name}`
                };
            }} label={editing ? "SAVE" : "CREATE"} />
        </div>
    </div>
}

export const RealmHeader = ({name}) => {
    const [realm, setRealm] = React.useState(null);
    const [showInfo, toggleInfo] = React.useState(false);

    const loadRealm = async () => {
        let result = await api.query("realm", name);
        if ("Err" in result) {
            setRealm(404);
            return;
        }
        setRealm(result.Ok);
    };

    React.useEffect(() => { loadRealm(); toggleInfo(false) }, [name]);

    setTitle(`realm ${name}`);

    if (!realm) return <Loading />;

    const colors = realmColors(name);
    const user = api._user;
    return <>
        <HeadBar title={<div className="vcentered max_width_col">
            {realm && realm.logo && <img alt="Logo" className="right_half_spaced" style={{ maxWidth: "40px"}} src={`data:image/png;base64, ${realm.logo}`} />}
            {name}
        </div>}
            shareLink={`realm/${name.toLowerCase()}`} shareTitle={`Realm ${name} on ${backendCache.name}`} styleArg={colors} 
            content={<>
                <ButtonWithLoading classNameArg="left_half_spaced monospace" styleArg={colors} testId="realm-close-button"
                        onClick={async () => {
                            window.realm = "";
                            location.href = "/#/home";
                        }}
                        label={<Close styleArg={{fill: colors.color}} small={true} />}
                    />
                <BurgerButton styleArg={colors} onClick={() => toggleInfo(!showInfo) } pressed={showInfo} testId="realm-burger-button" />
            </>}
        />
        {showInfo && <div className="stands_out">
            <Content value={realm.description} />
            <code>{realm.num_posts}</code> posts, <code>{realm.num_members}</code> members,
            controlled by: {userList(realm.controllers)}
            {user && <div className="row_container top_spaced flex_ended">
                {realm.controllers.includes(user.id) && <button className="right_half_spaced" onClick={() => {
                    location.href = `/#/realm/${name}/edit`;
                    toggleInfo(false);
                }}>EDIT</button>}
                {!user.realms.includes(name) && 
                <ButtonWithLoading label="JOIN" classNameArg="active"
                    onClick={async () => {
                        if (!confirm(`By joining the realm ${name} you confirm that you understand its description ` +
                            `and agree with all terms and conditions mentioned there. ` +
                            `Any rule violation can lead to a moderation by stalwarts or ` +
                            `moving out of the post with penalty of ${backendCache.config.realm_cleanup_penalty} points.`))
                            return false;
                        return api.call("toggle_realm_membership", name).then(api._reloadUser).then(loadRealm);
                    }} />
                }
                {user.realms.includes(name) && <ButtonWithLoading classNameArg="active" label="LEAVE"
                    onClick={async () => api.call("toggle_realm_membership", name).then(api._reloadUser).then(loadRealm)} />}
            </div>}
        </div>}
    </>;
};

export const Realms = () => {
    const [realms, setRealms] = React.useState([]);
    const [page, setPage] = React.useState(0);
    const [noMoreData, setNoMoreData] = React.useState(false);
    const loadRealms = async () => {
        let data = await api.query("realms", page);
        if (data.length == 0) {
            setNoMoreData(true);
        }
        setRealms(realms.concat(data))
    };
    React.useEffect(() => { loadRealms(); }, [page]);
    const user = api._user;
    return <>
        <HeadBar title="Realms" shareLink="realms" content={user && <button className="active" onClick={() => location.href = "/#/realms/create"}>CREATE</button>} />
        <div className={bigScreen() ? "two_column_grid_flex" : null} style={{rowGap: 0, columnGap: "1em"}}>
            {realms.map(([name, realm]) =>{
                return <div key={name} className="stands_out" style={{position: "relative"}}>
                    <RealmRibbon name={name} />
                    <h3 className="vcentered">
                        {realm.logo && <img alt="Logo" className="right_spaced" style={{ maxWidth: "70px"}} src={`data:image/png;base64, ${realm.logo}`} />}
                        <span className="max_width_col">
                            <a href={`/#/realm/${name}`}>{name}</a>
                        </span>
                    </h3>
                    <Content value={realm.description.split("\n")[0]} classNameArg="bottom_spaced" />
                    <>
                        <code>{realm.num_posts}</code> posts, <code>{realm.num_members}</code> members,
                        controlled by: {userList(realm.controllers)}
                    </>
                </div>;})}
        </div>
        {!noMoreData && <div style={{display:"flex", justifyContent: "center"}}>
            <ButtonWithLoading classNameArg="active" onClick={() => setPage(page + 1)} label="MORE" />
        </div>}
    </>;
}
