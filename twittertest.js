Classifiers = new Meteor.Collection('classifiers');
CurrentClassifier = new Meteor.Collection('currentclassifier');

if (Meteor.isClient) {

  Session.set('mode', 'home');

  Handlebars.registerHelper('mode', function(mode) {
    return Session.get('mode') === mode;
  });
  Handlebars.registerHelper('currentClassifier', function() {
    return CurrentClassifier.findOne();
  });  

  Template.home.events({
    'click #train': function() {
      Meteor.call('search', 'GBPUSD', new Date(new Date() - 86400000), 100, function(err, res) {
        Session.set('trainingSet', res.statuses.map(function(s) {
          return {message: s.text, id: s.id};
        }));
        Session.set('mode', 'training');
      });
    },
    'click #classify': function() {
      Session.set('mode', 'classify');
    },
    'click #sentiment': function() {
      Meteor.call('classifySet', 'GBPUSD', new Date(new Date() - 86400000), 100, function(errr, res) {
        Session.set('sentiment', res);
      });
      Session.set('mode', 'sentiment');
    }
  });

  Template.topbar.helpers({
    classifiers: function() {
      return Classifiers.find().fetch();
    }
  });
  Template.topbar.events({
    'click #classifierSelect li': function(event) {
      if (event.target && $(event.target).parents('li').attr('id') === "new") $('#newClassifier').foundation('reveal', 'open');
      else if (event.target && $(event.target).parents('li').attr('id')) {
        Meteor.call('loadClassifier', $(event.target).parents('li').attr('id'), function(err, res) {console.log(err, res);});
      }
    },
    'click #train': function() {
      Meteor.call('search', 'GBPUSD', new Date(new Date() - 86400000), 100, function(err, res) {
        Session.set('trainingSet', res.statuses.map(function(s) {
          return {message: s.text, id: s.id};
        }));
        Session.set('mode', 'training');
      });
    },
    'click #classify': function() {
      Session.set('mode', 'classify');
    },
    'click #sentiment': function() {
      Meteor.call('classifySet', 'GBPUSD', new Date(new Date() - 86400000), 100, function(errr, res) {
        Session.set('sentiment', res);
      });
      Session.set('mode', 'sentiment');
    },
    'click #newClassifier li': function(event) {
      if (!$('#classifierName').val()) $('#classifierName').focus();
      else {
        Meteor.call('changeClassifierType', event.target.id, function(err, res) {
          if (!err) {
            Meteor.call('newClassifier', $('#classifierName').val(), function(err, res) {
              if (!err) {
                $('#newClassifier').foundation('reveal', 'close');    
                Meteor.call('saveClassifier', function(err, res) {
                  console.log(err, res);                        
                });
              }
            });
          }
        });
      }
    },
    'click #deleteClassifier': function() {
      if (!CurrentClassifier.findOne()) return false;
      Classifiers.remove({_id: CurrentClassifier.findOne()._id});
      CurrentClassifier.remove({_id: CurrentClassifier.findOne()._id});      
    }
  });
  Template.topbar.rendered = function() {
    $(document).ready(function() {
      $(document).foundation();
    });
  };

  Template.trainingset.helpers({
    trainingData: function() {
      return Session.get('trainingSet');
    }
  });
  Template.trainingset.events({
    'click .suggest': function() {
      var updateClassification = function(entry) {
        Meteor.call('classify', entry.message, function(err, res) {
          if (!err) $('#' + entry.id).val(res);
        });
      };
      var trainingSet = Session.get('trainingSet');
      for (var i = 0, l = trainingSet.length; i < l; i++) {
        updateClassification(trainingSet[i]);
      }
    },
    'click a.submit': function() {
      if (!CurrentClassifier.findOne()) return false;
      var resDict = {}, trainingSet = Session.get('trainingSet');
      $('table td select').each(function(i, s) {resDict[s.id] = s.value;});
      trainingSet.forEach(function(s) {s.sentiment = resDict[s.id];});
      Meteor.call('trainClassifier', trainingSet, function(err, res) {console.log(err, res);});
    }
  });

  Template.classify.events({
    'click #classifyStatement': function() {
      if ($('#statement').val()) {
        Meteor.call('classify', $('#statement').val(), function(err, res) {
          if (!err) $('#classificationResults').html('<div class="panel">Statement classified as: <strong>' + res + '</strong></div>');
        });
      }
    }
  });

  Template.sentiment.helpers({
    score: function(category) {
      return Session.get('sentiment') ? mapToPercentages(Session.get('sentiment'))[category] : 0;
    }
  })

  Deps.autorun(function() {
    Meteor.subscribe('currentClassifier');
    Meteor.subscribe('classifiers');
  });

  mapToPercentages = function(dict) {
    var output = {};
    var total = Object.keys(dict).reduce(function(t, k) {return t + dict[k];}, 0);
    for (key in dict) {output[key] = dict[key] * 100 / total;}
    return output;
  }

  callFunc = function(name, args) {
    var cb = function(err, res) {console.log(err, res);};
    Meteor.call.apply(Meteor.call, [name].concat(args).concat(cb));
  }

}

if (Meteor.isServer) {

  var classifier, currentClassifierSubscription;

  Meteor.startup(function () {
    CurrentClassifier.remove({});
    Future = Npm.require('fibers/future');
    natural = Npm.require('natural');
    currentClassifierType = {type: 'bayes', constructor: natural.BayesClassifier};
    T = new TwitMaker({
      consumer_key:         'UEBsfVy4Yv91vDtZRObDw',
      consumer_secret:      'pUpDikJtDNu5GMQXXwnjiFz7E8SrJsQwhJHX6BEMU',
      access_token:         '271419228-WMyLDttfDYFatxJvA1uWAoAjP1dgRoFeLQSaWTB9',
      access_token_secret:  'no32c5oTXH4QiQb9tQ0dklOG4umWhvrQfbqyGzm9YHviw'
    });
  });

  currentClassifierSubscription = Meteor.publish('currentClassifier', function() {
    return CurrentClassifier.find({}, {fields: {name: 1, type: 1, _id: 1}});
  });
  classifiersSubscription = Meteor.publish('classifiers', function() {
    return Classifiers.find({}, {fields: {name: 1, type: 1, _id: 1}});
  });

  var updateClassifierStream = function() {
    CurrentClassifier.remove({});
    if (classifier && classifier.name) CurrentClassifier.insert(Classifiers.findOne({name: classifier.name}));
  }

  var changeClassifier = function(type) {
    if (type === 'bayes') {
      currentClassifierType = {type: 'bayes', constructor: natural.BayesClassifier};
      return 'Changed to bayes classifier';
    }
    else if (type === 'logistic') {
      currentClassifierType = {type: 'logistic', constructor: natural.LogisticRegressionClassifier};
      return 'Changed to logistic classifier';
    }
    else return "Unrecognised classifier type"
  }

  Meteor.methods({
    search: function(keyword, startdate, limit) {
      var fut = new Future()
      if (startdate instanceof Date) startdate = startdate.toISOString().slice(0,10);
      T.get('search/tweets', {q: keyword + ' since:' + startdate, count: limit, lang: 'en'}, function(err, res) {
        if (err) fut['return'](err);
        else fut['return'](res);
      });
      return fut.wait();
    },
    changeClassifierType: function(type) {
      return changeClassifier(type);
    },
    newClassifier: function(classifierName) {
      classifier = new currentClassifierType.constructor();
      if (classifierName) classifier.name = classifierName;
      updateClassifierStream();
      return "New " + currentClassifierType.type + " classifier initialised";
    },
    loadClassifier: function(classifierName) {
      var classifierEntry = Classifiers.findOne({name: classifierName});
      if (classifierEntry) {
        changeClassifier(classifierEntry.type);
        classifier = currentClassifierType.constructor.restore(JSON.parse(classifierEntry.data));
        classifier.name = classifierName;
        updateClassifierStream();
        return "Classifier " + classifierName + " loaded";
      }
      else return "Cannot find classifier " + classifierName;
    },
    saveClassifier: function(classifierName) {
      if (!classifierName) classifierName = classifier.name;
      if (classifier) {
        Classifiers.upsert({name: classifierName}, {$set: {data: JSON.stringify(classifier), type: currentClassifierType.type}});
        classifier.name = classifierName;
        updateClassifierStream();
        return "Classifier saved as " + classifierName;
      }
      else return "No active classifier";
    },
    classifications: function(text) {
      if (classifier) {
        return classifier.getClassifications(text);
      }
      else return "No active classifier";
    },
    classify: function(text) {
      if (classifier) {
        return classifier.classify(text);
      }
      else return "No active classifier";
    },
    trainClassifier: function(trainingSet) {
      for (var i = 0, l = trainingSet.length; i < l; i++) {
        console.log("Training item " + (i+1) + " of " + l);
        classifier.addDocument(trainingSet[i].message, trainingSet[i].sentiment);
      }
      classifier.train();
      return "Training data added";      
    },
    trainOnJSON: function(filename) {
      var trainingSet, fut = new Future();
      if (!classifier) return "No active classifier";
      Assets.getText(filename, function(err, res) {
        if (err) fut['return']("Cannot load file " + filename);
        else trainingSet = JSON.parse(res);
        for (var i = 0, l = trainingSet.length; i < l; i++) {
          console.log("Training item " + (i+1) + " of " + l);
          classifier.addDocument(trainingSet[i].message, trainingSet[i].sentiment);
        }
        classifier.train();
        fut['return']("Training data added");
      });
      return fut.wait();
    },
    logVar: function(variable) {
      return eval(variable);
    },
    classifySet: function(keyword, startdate, limit) {
      var fut = new Future(), ans = new Future(), results = {}
      if (startdate instanceof Date) startdate = startdate.toISOString().slice(0,10);
      T.get('search/tweets', {q: keyword + ' since:' + startdate, count: limit, lang: 'en'}, function(err, res) {
        if (err) fut['return'](err);
        else if (!res.statuses) fut['return']('no results');
        else {
          fut['return'](res.statuses.map(function(s) {
            return classifier.getClassifications(s.text);
          }));
          fut.wait()[0].forEach(function(c) {results[c.label] = 0;});
          fut.wait().forEach(function(r) {r.forEach(function(c) {results[c.label] += c.value;})});
          ans['return'](results);
        }
      });
      return ans.wait();
    }
  });

}
