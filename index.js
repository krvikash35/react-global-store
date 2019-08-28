import React, { useContext, useState, createContext, useRef } from "react";
import axios from "axios";

const allProviders = [];
const allContexts = {};
const tokens = {};

function mergeState(state, delta, actionKey) {
  const deltaState = {};
  const { data, error, ...restDelta } = delta;
  Object.keys(restDelta).forEach(deltaKey => {
    if (state.hasOwnProperty(deltaKey)) {
      if (state[deltaKey].hasOwnProperty("loading")) {
        deltaState[deltaKey] = {
          ...state[deltaKey],
          data: restDelta[deltaKey]
        };
      } else {
        deltaState[deltaKey] = restDelta[deltaKey];
      }
    }
  });
  if (actionKey) {
    if (data) {
      deltaState[actionKey] = { data, loading: false, error: null };
    } else if (error) {
      deltaState[actionKey] = {
        data: state[actionKey].data,
        loading: false,
        error
      };
    } else {
      deltaState[actionKey] = {
        data: state[actionKey].data,
        loading: false,
        error: state[actionKey].error
      };
    }
  }
  return deltaState;
}

function isAction(storeAttr) {
  return typeof storeAttr === "function";
}

function isSyncAction(storeAttr) {
  return isAction(storeAttr) && storeAttr.sync === true;
}

function isObject(data) {
  return data !== null && typeof data === "object";
}

function isAsyncDataState(state, data) {
  if (!isObject(data)) return false;
  const sprops = Object.getOwnPropertyNames(state);
  return sprops.some(p => data.hasOwnProperty(p));
}

function initStoreState(store) {
  const state = {};
  Object.keys(store).forEach(storeAttrName => {
    const storeAttr = store[storeAttrName];
    if (!isAction(storeAttr)) {
      state[storeAttrName] = storeAttr;
    } else if (!isSyncAction(storeAttr)) {
      state[storeAttrName] = { loading: false, data: null, error: null };
    }
  });
  return state;
}

function setupStoreProviderValue(store, state, setState, stateRef, storeName) {
  const value = {};
  Object.keys(store).forEach(storeAttrName => {
    const storeAttr = store[storeAttrName];
    if (!isAction(storeAttr)) {
      value[storeAttrName] = state[storeAttrName];
    } else if (isSyncAction(storeAttr)) {
      value[storeAttrName] = (...p) => {
        let result = storeAttr(...p);
        if (isAction(result)) {
          result = result(stateRef.current);
        }
        if (!isObject(result)) return;
        const newState = mergeState(stateRef.current, result);
        setState(s => ({ ...s, ...newState }));
      };
    } else {
      value[storeAttrName] = async (...p) => {
        value[storeAttrName].cancel();
        setState({
          ...state,
          [storeAttrName]: { ...state[storeAttrName], loading: true }
        });
        try {
          const promise = storeAttr(...p);
          let result = await promise;
          if (isAction(result)) {
            result = result(stateRef.current);
          }
          if (isAsyncDataState(state, result)) {
            const newState = mergeState(
              stateRef.current,
              result,
              storeAttrName
            );
            setState(s => ({ ...s, ...newState }));
          } else {
            setState(s => ({
              ...s,
              [storeAttrName]: {
                loading: false,
                data: result,
                error: null
              }
            }));
          }
        } catch (stateUpdater) {
          if (isAction(stateUpdater)) {
            stateUpdater = stateUpdater(stateRef.current);
          }
          if (stateUpdater.config) {
            if (axios.isCancel(stateUpdater)) {
              setState(s => ({
                ...s,
                [storeAttrName]: { ...s[storeAttrName], loading: false }
              }));
            } else {
              let error = {};
              if (stateUpdater.response) {
                error.code = stateUpdater.response.status;
                error.data = stateUpdater.response.data;
              } else if (stateUpdater.request) {
                error.code = "ERR_NO_SERVER_RESPONSE";
              } else {
                error.code = "ERR_AXIOS_REQUEST";
                error.message = stateUpdater.message;
              }
              setState(s => ({
                ...s,
                [storeAttrName]: { ...s[storeAttrName], loading: false, error }
              }));
            }
          } else {
            if (isAsyncDataState(state, stateUpdater)) {
              const newState = mergeState(
                stateRef.current,
                stateUpdater,
                storeAttrName
              );
              setState(s => ({ ...s, ...newState }));
            } else {
              setState(s => ({
                ...s,
                [storeAttrName]: {
                  loading: false,
                  data: s[storeAttrName].data,
                  error: stateUpdater
                }
              }));
            }
          }
        }
      };
      value[storeAttrName].data = state[storeAttrName].data;
      value[storeAttrName].loading = state[storeAttrName].loading;
      value[storeAttrName].error = state[storeAttrName].error;
      value[storeAttrName].reset = () => {
        setState(s => ({
          ...s,
          [storeAttrName]: { data: null, error: null, loading: false }
        }));
      };
      value[storeAttrName].cancel = () => {
        const cancel = tokens[storeName][storeAttrName];
        if (cancel) {
          cancel();
          tokens[storeName][storeAttrName] = null;
        }
      };
    }
  });
  return value;
}

export function useStore(storeName) {
  const storeContext = allContexts[storeName];
  if (!storeContext)
    throw new Error(`useStore: store with name ${storeName} not found`);
  const store = useContext(allContexts[storeName]);
  return store;
}

export function createStore(stores) {
  Object.keys(stores).forEach(storeName => {
    const store = stores[storeName];
    const context = createContext();
    context.displayName = storeName;
    tokens[storeName] = {};
    function Provider(props) {
      const initialState = initStoreState(store);
      const [state, setState] = useState(initialState);
      const stateRef = useRef(state);
      stateRef.current = state;
      const providerValue = setupStoreProviderValue(
        store,
        state,
        setState,
        stateRef,
        storeName
      );
      return (
        <context.Provider value={providerValue}>
          {props.children}
        </context.Provider>
      );
    }
    Provider.displayName = storeName;

    allProviders.push(Provider);
    allContexts[storeName] = context;
  });
  return function Store(props) {
    let store = "";
    allProviders.forEach((P, index) => {
      if (index === 0) {
        store = <P>{props.children}</P>;
      } else {
        store = <P>{store}</P>;
      }
    });
    return store;
  };
}

export function setupCancelToken(storeName, actionFunName, axiosConfig) {
  if (!tokens[storeName])
    return console.warn(
      `setupCancelToken: store with name ${storeName} not found`
    );
  const source = axios.CancelToken.source();
  axiosConfig.cancelToken = source.token;
  tokens[storeName][actionFunName] = source.cancel;
}
