import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import {closeAIAgentModal} from '../reducers/modals';
import AIAgentModalComponent from '../components/ai-agent-modal/ai-agent-modal.jsx';

const AIAgentModal = props => (
    <AIAgentModalComponent
        onClose={props.onClose}
        vm={props.vm}
    />
);

AIAgentModal.propTypes = {
    onClose: PropTypes.func.isRequired,
    vm: PropTypes.shape({
        runtime: PropTypes.shape({
            targets: PropTypes.array
        })
    })
};

const mapStateToProps = state => ({
    vm: state.scratchGui.vm
});

const mapDispatchToProps = dispatch => ({
    onClose: () => dispatch(closeAIAgentModal())
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(AIAgentModal);
