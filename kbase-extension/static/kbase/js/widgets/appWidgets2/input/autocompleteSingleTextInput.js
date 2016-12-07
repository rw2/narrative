/*global define*/
/*jslint white:true,browser:true*/
define([
    'jquery',
    'bluebird',
    'base/js/namespace',
    'kb_common/html',
    'common/validation',
    'common/events',
    'common/dom',
    'common/runtime',
    '../inputUtils',
    'bloodhound',
    'narrativeConfig',
    'Taxonomy-client-api',
    'kbase-generic-client-api',

    'typeahead',
    'bootstrap',
    'css!font-awesome'
], function(
    $,
    Promise,
    Jupyter,
    html,
    Validation,
    Events,
    Dom,
    Runtime,
    inputUtils,
    Bloodhound,
    Config,
    TaxonomyClientAPI,
    GenericClient
) {
    'use strict';

    // Constants
    var t = html.tag,
        div = t('div'),
        input = t('input');

    // XXX Erik - the config still doesn't contain the service parameter. I really need that for a generic autocomplete widget

    function factory(config) {
        var options = {},
            constraints,
            parent,
            container,
            bus = config.bus,
            dom,
            model = {
                value: undefined
            };

        if (config.parameterSpec) {
            constraints = config.parameterSpec.data.constraints;
        } else {
            constraints = config.constraints;
        }

        //
        // Validate configuration.
        // Nothing to do...

        options.enabled = true;


        /*
         * If the parameter is optional, and is empty, return null.
         * If it allows multiple values, wrap single results in an array
         * There is a weird twist where if it ...
         * well, hmm, the only consumer of this, isValid, expects the values
         * to mirror the input rows, so we shouldn't really filter out any
         * values.
         */

        function getInputValue() {
            return dom.getElement('autocomplete-container.input').value;
        }

        function setModelValue(value) {
            return Promise.try(function() {
                    if (model.value !== value) {
                        model.value = value;
                        return true;
                    }
                    return false;
                })
                .then(function(changed) {
                    render();
                });
        }

        function unsetModelValue() {
            return Promise.try(function() {
                    model.value = undefined;
                })
                .then(function(changed) {
                    render();
                });
        }

        function resetModelValue() {
            if (constraints.defaultValue) {
                setModelValue(constraints.defaultValue);
            } else {
                unsetModelValue();
            }
        }

        /*
         *
         * Text fields can occur in multiples.
         * We have a choice, treat single-text fields as a own widget
         * or as a special case of multiple-entry --
         * with a min-items of 1 and max-items of 1.
         *
         *
         */

        function validate(rawValue) {

            return Promise.try(function() {
                if (!options.enabled) {
                    return {
                        isValid: true,
                        validated: false,
                        diagnosis: 'disabled'
                    };
                }
                if (rawValue === undefined) {
                    rawValue = getInputValue();
                }
                return Validation.validateTextString(rawValue, constraints);
            });
        }

        /*
         * Creates the markup
         * Places it into the dom node
         * Hooks up event listeners
         */
        function handleChange(newValue) {

            validate(newValue)
                .then(function(result) {
                    if (result.isValid) {
                        setModelValue(result.parsedValue);
                        bus.emit('changed', {
                            newValue: result.parsedValue
                        });
                    } else if (result.diagnosis === 'required-missing') {
                        setModelValue(result.parsedValue);
                        bus.emit('changed', {
                            newValue: result.parsedValue
                        });
                    } else {
                        if (config.showOwnMessages) {
                            var message = inputUtils.buildMessageAlert({
                                title: 'ERROR',
                                type: 'danger',
                                id: result.messageId,
                                message: result.errorMessage
                            });
                            dom.setContent('autocomplete-container.message', message.content);
                            message.events.attachEvents();
                        }
                    }

                    bus.emit('validation', {
                        errorMessage: result.errorMessage,
                        diagnosis: result.diagnosis
                    });
                });
        }

        function makeInputControl(currentValue) {
            return input({
                id: html.genId(),
                class: 'form-control',
                dataElement: 'input',
                value: (currentValue || {}).label
            });
        }

        function render() {
            var ic_id;
            var span_id = html.genId();
            var sub_id = html.genId();

            Promise.try(function() {
                    var events = Events.make(),
                        inputControl = makeInputControl(model.value, events, bus);

                    /* XXX Erik

                       Here's where the wheels really start to fall off - for the private taxon method, we need to display just the text field to start
                       but after the user has typed something in, we should add this extra label underneath it that just says "Parent: $parent", with
                       whatever the parent field is that was returned from the autocomplete. I'd originally tried adding it in with a display value of none, in the
                       of changing the style later when the results from typeahead comes back, but it re-renders and nukes the field anyway.

                       So I tried setting the currentValue to the array I need, but that fails the validation step.

                       and it all gets screwed up once I learned that we should only display the label in the text field, the actual value returned needs to be the id.

                       I'm lost on this.
                    */

                    var currentValue = model.value || {};
                    var $inputContainer = $.jqElem('div');
                    $inputContainer.append(inputControl);
                    var $spanContainer = $.jqElem('span').attr('id', span_id).text(currentValue.parent ? currentValue.parent : '');
                    var $subContainer =
                      $.jqElem('div')
                        .css('display', currentValue.parent ? 'block' : 'none')
                        .attr('id', sub_id)
                        .append(
                          "Parent:"
                        )
                        .append(
                          $spanContainer
                        )
                    ;

                    $inputContainer.append($subContainer);

                    dom.setContent('autocomplete-container', $inputContainer.html());
                    ic_id = $(inputControl).attr('id');

                    events.attachEvents(container);
                })
                .then(function() {
                    setTimeout(function() {
                        var genericClient = new GenericClient(Config.url('service_wizard'), {token : Runtime.make().authToken()});

                        var publicDog = new Bloodhound({
                          datumTokenizer: Bloodhound.tokenizers.whitespace,
                          queryTokenizer: Bloodhound.tokenizers.whitespace,
                          // `states` is an array of state names defined in "The Basics"
                          remote : {
                            url : 'http://kbase.us/some/fake/url',  //bloodhound remote requires a URL
                            filter : function(query, settings) {
                              return query.hits;
                              return states;
                            },
                            prepare : function(settings) {
                              return settings;
                            },
                            transport : function(options, onSuccess, onError) {
                              genericClient.sync_call("taxonomy_service.search_taxonomy", [
                                {
                                  private : 0,
                                  public : 1,
                                  search : options.url,
                                  limit : 10,
                                  start : 0,
                                }
                              ]).then(function(d) {
                                onSuccess(d[0]);
                              }).fail(function(e) {
                                onError(e);
                              });

                            }
                          }
                        });

                        var privateDog = new Bloodhound({
                          datumTokenizer: Bloodhound.tokenizers.whitespace,
                          queryTokenizer: Bloodhound.tokenizers.whitespace,
                          remote : {
                            url : 'http://kbase.us/some/fake/url',  //bloodhound remote requires a URL
                            filter : function(query, settings) {
                              return query.hits;
                              return states;
                            },
                            prepare : function(settings) {
                              return settings;
                            },
                            transport : function(options, onSuccess, onError) {
                              genericClient.sync_call("taxonomy_service.search_taxonomy", [
                                {
                                  private : 1,
                                  public : 0,
                                  search : options.url,
                                  limit : 10,
                                  start : 0,
                                }
                              ]).then(function(d) {
                                onSuccess(d[0]);
                              }).fail(function(e) {
                                onError(e);
                              });

                            }
                          }
                        });
                        var $control = $('#' + ic_id);
                        $control.typeahead({
                            hint: true,
                            highlight: true,
                            minLength: 2,
                            limit: 10
                        },
                        {
                          name : 'public',
                          source : publicDog,
                          display : function(v) {
                            return v.label
                          },
                          templates: { header: '<h4 class="tt-header">Public data</h4>' }
                        },
                        {
                          name : 'private',
                          source : privateDog,
                          display : function(v) {
                            return v.label
                          },
                          templates: { header: '<h4 class="tt-header">Private data</h4>' }
                        });
                        $control.bind('typeahead:select', function(e, suggestion) {
                            // NB for 'select' event it is the suggestion object,
                            // for 'chnage' it is the display value as defined above.
                            // e.g.
                            // category: "public"
                            // id: "1779/300381/1"
                            // label: "Klebsiella sp. ok1_1_9_S34"
                            // parent: "Klebsiella"
                            // parent_ref: "1779/139747/1"
                            // console.log('suggestion', suggestion);

                            // XXX Erik - this doesn't work, because after handleChange is invoked, I guess render is called at some point?
                            // which causes a new element to be displayed on the page, which overwrites this completely.
                            $('#'.sub_id).css('display', 'block');
                            $('#'.span_id).text(suggestion.parent);

                            // XXX Erik
                            // Okay, now here's where it really starts to suck - for the create private taxon method ONLY, I need to maintain three values
                            // the scientific name, the id, and the parent.
                            // the scientific_name should be displayed in the text field itself, the parent is populated into a static label that sits
                            // beneath the input box (once the user has typed something in), but the value which needs to be returned by the widget is
                            // [id, parent], because that's what needs to be handed onto the service.
                            //
                            // This fails immediately because there's no way to validate an array. So is that a new method in validation.js? How should
                            // that be created and invoked?
                            //
                            // for any other method (and a generic case), we need to display the label in the text field, but return the ID upon invoking
                            // the method. Halp.
                            handleChange([suggestion.label, suggestion.parent]);
                        });
                    }, 1);
                    return autoValidate();
                });
        }

        function layout(events) {
            var content = div({
                dataElement: 'main-panel'
            }, [
                div({ dataElement: 'autocomplete-container' })
            ]);
            return {
                content: content,
                events: events
            };
        }

        function autoValidate() {
            return validate()
                .then(function(result) {
                    bus.emit('validation', {
                        errorMessage: result.errorMessage,
                        diagnosis: result.diagnosis
                    });
                });
        }


        // LIFECYCLE API

        function start() {
            return Promise.try(function() {
                bus.on('run', function(message) {

                    parent = message.node;
                    container = parent.appendChild(document.createElement('div'));
                    dom = Dom.make({ node: message.node });

                    var events = Events.make(),
                        theLayout = layout(events);

                    container.innerHTML = theLayout.content;
                    events.attachEvents(container);

                    bus.on('reset-to-defaults', function(message) {
                        resetModelValue();
                    });
                    bus.on('update', function(message) {
                        setModelValue(message.value);
                    });
                    bus.emit('sync');
                });
            });
        }

        return {
            start: start
        };
    }

    return {
        make: function(config) {
            return factory(config);
        }
    };
});
